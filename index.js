require('dotenv').config();
var Botkit = require('botkit');
var octonode = require('octonode');
var Raven = require('raven');
var tabsToSpaces = require('tabs-to-spaces');
var request = require('request');

const slackMsgCharLimit = 3000;

if (!process.env.SOBER_ID || !process.env.SOBER_SECRET || !process.env.SOBER_PORT || !process.env.SOBER_TOKEN || !process.env.SOBER_SENTRY) {
    console.log('Error: Specify SOBER_ID, SOBER_SECRET, SOBER_TOKEN, SOBER_PORT and SOBER_SENTRY in environment');
    process.exit(1);
}

if (process.env.SOBER_GHID && process.env.SOBER_GHSECRET) {
    var github = octonode.client({
        id: process.env.SOBER_GHID,
        secret: process.env.SOBER_GHSECRET
    });
} else {
    var github = octonode.client();
}

var config = {
    clientId: process.env.SOBER_ID,
    clientSecret: process.env.SOBER_SECRET,
    redirectUri: process.env.SOBER_REDIRECT,
    debug: false,
    scopes: ['commands'],
    require_delivery: false
}

if (process.env.SOBER_MONGO) {
    var mongoStorage = require('botkit-storage-mongo')({mongoUri: process.env.SOBER_MONGO});
    config.storage = mongoStorage;
} else {
    config.json_file_store = './store/'; // store user data in a simple JSON format
}

Raven.config(process.env.SOBER_SENTRY, {
    ignoreErrors: ['Not Found', 'No commit found']
}).install();

function messageBuilder(repoTokens, path, lineMargins, textResult) {
    var message = "";
    if (lineMargins) {
        message += `Lines ${lineMargins[0]} to ${lineMargins[1]} from `;
    }

    message += `${path} in `;

    if (repoTokens[2]) {
        message += `the ${repoTokens[2]} branch of `;
    }

    message += `${repoTokens[0]}/${repoTokens[1]}:\n`;

    message += `\`\`\`\n${textResult}\n\`\`\``;

    return message;
}

function codeReformat(code) {
    var newCode = tabsToSpaces(code, 4);
    var choppedCode = newCode.split("\n");
    var baseSpaceCount = Infinity;
    choppedCode.forEach(function(codeLine, lineIndex) {
        if (codeLine.length == 0) {
            var newSpaceAmount = 0;
            if (lineIndex-1 < 0 && choppedCode.length-1 < lineIndex+1) {
                newSpaceAmount = 0;
            } else if (lineIndex-1 < 0) {
                newSpaceAmount = choppedCode[lineIndex+1].search(/\S/);
                if (newSpaceAmount < 0) newSpaceAmount = 0;
            } else {
                newSpaceAmount = choppedCode[lineIndex-1].search(/\S/);
                if (newSpaceAmount < 0) newSpaceAmount = 0;
            }
            choppedCode[lineIndex] = " ".repeat(newSpaceAmount) + codeLine;
        }
    });
    choppedCode.forEach(function(codeLine) {
        var spaceCount = codeLine.search(/\S|$/);
        if (spaceCount < baseSpaceCount) // check if it's LOWER to avoid chopping acutal code on lower space levels
            baseSpaceCount = spaceCount;
    });
    if (baseSpaceCount < 0) baseSpaceCount = 0;
    choppedCode = choppedCode.map(codeLine => codeLine.substr(baseSpaceCount));
    newCode = choppedCode.join("\n");
//    newCode = newCode.replace(/`/g, "&#96;");
    return newCode;
}

function fullChunk(messageText) {
    var messageArray = [];
    if (messageText.length > slackMsgCharLimit) {
        for (var i = 0; i < Math.ceil(messageText.length/(slackMsgCharLimit-4)); i++) {
            if (i == 0) // first line, no starting ```
                messageArray.push(messageText.substr(0, slackMsgCharLimit-4) + "\n```");
            else if (i == Math.ceil(messageText.length/(slackMsgCharLimit-4))-1) // if last line, don't add closing ``` (it's already there.)
                messageArray.push("```\n" + messageText.substr(i*slackMsgCharLimit-8, slackMsgCharLimit-8));
            else // inbetween lines, starting & closing ```
                messageArray.push("```\n" + messageText.substr(i == 1 ? (i*slackMsgCharLimit-4) : (i*slackMsgCharLimit-8), slackMsgCharLimit-8) + "\n```");
        }
    } else
        messageArray.push(messageText);
    return messageArray;
}

var controller = Botkit.slackbot(config);

controller.setupWebserver(process.env.SOBER_PORT, function (err, webserver) {
    controller.createWebhookEndpoints(controller.webserver);

    controller.createOauthEndpoints(controller.webserver, function (err, req, res) {
        if (err) {
            res.redirect("/error.html");
        } else {
            res.redirect("/success.html");
        }
    });
});

controller.on('slash_command', function (slashCommand, message) {
    if (message.token !== process.env.SOBER_TOKEN) {
        console.log("Incorrect token.");
        return; //just ignore it.
    }

    var errctx = {
        command: message.command,
        rawMessage: message.text
    };

    switch (message.command) {
        case "/sober":
            var tokens = message.text.split(":");

            if (tokens.length < 2 || tokens.length > 3) {
                slashCommand.replyPrivate(message, "Insufficent or too much data.\nExample command: `/sober candyref/candy:index.js:1-5`, where `candyref/candy` is a GitHub repository, `index.js` is the path of the requested file, and `1-5` is lines 1 to 5 (optional).\nNeed more help? Visit https://sober.skiilaa.me.");
                return;
            }

            var repoTokens = tokens[0].split("/");

            if (repoTokens.length < 2 || repoTokens.length > 3) {
                slashCommand.replyPrivate(message, "Invalid specification of repository owner and repository name (and branch name, optional). (ex. \"octocat/hello-world\", \"octocat/hello-world/master\")");
                return;
            }

            var filePath = tokens[1];

            var lineMargins;

            if (tokens.length == 3) {
                var lineMarginsT = tokens[2].split("-");
                if (tokens[2].match(/\d+-\d+/)) {
                    lineMargins = [parseInt(lineMarginsT[0]), parseInt(lineMarginsT[1])];
                } else if (tokens[2].match(/\d+-/)) {
                    lineMargins = [parseInt(lineMarginsT[0]), -1];
                } else if (tokens[2].match(/-\d+/)) {
                    lineMargins = [1, parseInt(lineMarginsT[1])];
                } else {
                    slashCommand.replyPrivate(message, "Invalid specification of line margin. (ex. \"5-10\")");
                    return;
                }
            }

            var ghReq = {
                owner: repoTokens[0],
                repo: repoTokens[1],
                path: filePath
            };

            if (repoTokens[2]) ghReq.ref = repoTokens[2];

            github.repo(`${repoTokens[0]}/${repoTokens[1]}`).contents(filePath, repoTokens[2] ? repoTokens[2] : "master", function(err, result) {
                if (err) {
                    slashCommand.replyPrivate(message, `${err}`);
                    Raven.captureException(err, { extra: errctx });
                    return;
                }
                var textResult = new Buffer(result.content, result.encoding).toString('utf8');

                if (lineMargins) {
                    if (lineMargins[1] == -1) lineMargins[1] = textResult.split("\n").length;
                    textResult = codeReformat(textResult.split("\n").slice(lineMargins[0]-1, lineMargins[1]).join("\n"));
                }

                var chunkedResult = fullChunk(messageBuilder(repoTokens, filePath, lineMargins, textResult));

                slashCommand.replyPublic(message, chunkedResult[0]);
                if (chunkedResult.length > 1) {
                    for (var i = 1; i < chunkedResult.length; i++) {
                        var replyDone = false;
                        request({
                            uri: message.response_url,
                            method: 'POST',
                            json: { // add thread_ts for threads in the future
                                text: chunkedResult[i],
                                channel: message.channel,
                                to: message.user,
                                response_type: 'in_channel'
                            }
                        }, function(err, resp, body) {
                            replyDone = true;
                            if (err) {
                                Raven.captureException(err, { extra: errctx, tags: { component: "delayMessage" } });
                            }
                        });
                        require('deasync').loopWhile(function() { return !replyDone; });
                    }
                }
            });

            break;
        default:
            slashCommand.replyPublic(message, "I'm afraid I don't know how to " + message.command + " yet.");

    }

});
