process.on('uncaughtException', function (err) {
  console.log('Caught exception: ', err);
});

require('dotenv').config();
var Botkit = require('botkit');
var github = require('octonode').client();
var Raven = require('raven');

if (!process.env.SOBER_ID || !process.env.SOBER_SECRET || !process.env.SOBER_PORT || !process.env.SOBER_TOKEN || !process.env.SOBER_SENTRY) {
    console.log('Error: Specify SOBER_ID, SOBER_SECRET, SOBER_TOKEN, SOBER_PORT and SOBER_SENTRY in environment');
    process.exit(1);
}

var config = {
    clientId: process.env.SOBER_ID,
    clientSecret: process.env.SOBER_SECRET,
    redirectUri: 'https://sober.skiilaa.me/bot/oauth',
    debug: false,
    scopes: ['commands']
}

if (process.env.SOBER_MONGO) {
    var mongoStorage = require('botkit-storage-mongo')({mongoUri: process.env.SOBER_MONGO});
    config.storage = mongoStorage;
} else {
    config.json_file_store = './store/'; // store user data in a simple JSON format
}

Raven.config(process.env.SOBER_SENTRY, {
    ignoreErrors: ['Not Found']
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

var controller = Botkit.slackbot(config);

controller.setupWebserver(process.env.SOBER_PORT, function (err, webserver) {
    controller.createWebhookEndpoints(controller.webserver);

    controller.createOauthEndpoints(controller.webserver, function (err, req, res) {
        if (err) {
            res.status(500).send('ERROR: ' + err);
        } else {
            res.send('Success!');
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
                if (lineMarginsT.length == 2 && tokens[2].match(/\d+-\d+/)) {
                    lineMargins = [parseInt(lineMarginsT[0]), parseInt(lineMarginsT[1])];
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
                    textResult = textResult.split("\n").slice(lineMargins[0]-1, lineMargins[1]).join("\n");
                }

                slashCommand.replyPublic(message, messageBuilder(repoTokens, filePath, lineMargins, textResult));
            });

            break;
        default:
            slashCommand.replyPublic(message, "I'm afraid I don't know how to " + message.command + " yet.");

    }

});
