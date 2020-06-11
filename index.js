const Game = require("./game");
const Twilio = require("twilio");
const QRCode = require("qrcode");

const CMD_PREFIX = "/";

const client = new Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

let games = {};
let registry = {};

function sendPM({ to, body, media }) {
  // todo support chat PM
  client.messages.create({
    from: to.proxy_address,
    to: to.address,
    body: "[private]: " + body,
    ...(media && { mediaUrl: media }),
  });
}

module.exports = function handler(message) {
  console.log("handler: ", message);

  if (message.text.startsWith(CMD_PREFIX)) {
    const { user, text } = message;
    let { channel } = message;
    const parts = text.split(" ");
    const command = parts[0];
    const args = parts.slice(1);

    if (command == "/start" || command == "/create") {
      if (
        games.hasOwnProperty(channel) &&
        !(games[channel].currentTurn == "End" || games[channel].currentTurn == "Beginning")
      ) {
        sendPM({
          to: user,
          body: "A game is already in progress...",
        });
        return false;
      }
      let identities = {};
      if (games.hasOwnProperty(channel) && games[channel].currentTurn == "End") {
        // save the identities in case of game restart
        identities = games[channel].identities;
        delete games[channel];
      }
      if (!games.hasOwnProperty(channel)) {
        // create a new game and add any users as arguments
        games[channel] = new Game(client, channel);
        registry[games[channel].gameID] = channel;
        games[channel].identities = identities;
      }
      // console.log("GAME:", games[channel]);
      if (command == "/start") {
        games[channel].start(args);
      }
    } else if (command == "/name") {
      if (!games.hasOwnProperty(channel)) {
        sendPM({
          to: user,
          body: "Can't find a game to set your name try /create first",
        });
        return false;
      }
      const id = args.join("_");
      if (Object.values(games[channel].identities).find((u) => u.identity === id)) {
        sendPM({
          to: user,
          body: "Someone already has the name: " + id,
        });
        return false;
      }
      games[channel]
        .addPlayers()
        .then((p) => {
          games[channel].identities[user.sid].identity = id;
          client.conversations
            .conversations(channel)
            .messages.create({ author: "bot", body: user.address + " is now known as: " + id });
        })
        .catch((err) => console.error(err));
    } else if (command == "/qrcode") {
      if (!games.hasOwnProperty(channel)) {
        sendPM({
          to: user,
          body: "Can't find a game to invite to. Try /create first",
        });
        return false;
      }
      if (games[channel].currentTurn !== "Beginning") {
        sendPM({
          to: user,
          body: "Game has already started...",
        });
        return false;
      }
      QRCode.toFile(
        "public/invites/qr-"+channel+".png",
        "SMSTO:"+user.proxy_address+":/join " + games[channel].gameID,
        {
        },
        function (err) {
          if (err) throw err;
          sendPM({
            to: user,
            body: "this QR can be used to join game: " + games[channel].gameID,
            media: process.env.PUBLIC_BASE_URL + "/invites/qr-"+channel+".png",
          });
        }
      );
    } else if (command == "/invite") {
      if (!games.hasOwnProperty(channel)) {
        sendPM({
          to: user,
          body: "Can't find a game to invite to. Try /create first",
        });
        return false;
      }
      if (games[channel].currentTurn !== "Beginning") {
        sendPM({
          to: user,
          body: "Game has already started...",
        });
        return false;
      }
      for (let inv of args) {
        sendPM({
          to: { address: inv, proxy_address: process.env.SMS_NUMBER },
          body:
            "You're invited to a game of *Ultimate Werewolf*. To join send `/join " +
            games[channel].gameID +
            " [username]`",
        });
      }
    } else if (command == "/join") {
      const gameID = args[0];
      if (!registry.hasOwnProperty(gameID)) {
        sendPM({
          to: user,
          body: "Can't find a game with that ID...",
        });
        return false;
      } else if (games[registry[gameID]].currentTurn !== "Beginning") {
        sendPM({
          to: user,
          body: "Game has already started...",
        });
        return false;
      } else {
        const join_channel = registry[gameID];
        // todo chat users
        client.conversations
          .conversations(channel)
          .remove()
          .then((c) => {
            client.conversations
              .conversations(join_channel)
              .participants.create({
                "messagingBinding.address": user.address,
                "messagingBinding.proxyAddress": user.proxy_address,
              })
              .then((p) => {
                const name = args.slice(1).join("_");
                const id = { identity: name ? name : p.identity ? p.identity : p.messagingBinding.address };
                const user = {
                  ...(p.messagingBinding && { ...p.messagingBinding }),
                  ...id,
                  sid: p.sid,
                }
                // add player to game
                games[registry[gameID]].players.push(p.sid);
                games[registry[gameID]].identities[p.sid] = user;
                sendPM({
                  to: user,
                  body: "Hint: reply with `/name username` the set a nickname",
                });
                client.conversations
                  .conversations(join_channel)
                  .messages.create({ author: "bot", body: "A new player: <" + id.identity + "> has joined the game!" });
              })
              .catch((err) => {
                console.error(err);
              });
          })
          .catch((err) => {
            console.error(err);
          });
      }
    } else if (command.startsWith("/quit")) {
      client.conversations
        .conversations(channel)
        .participants(user.sid)
        .remove()
        .then((c) => {
          const id = games[channel].identities[user.sid].identity;
          client.conversations
            .conversations(channel)
            .messages.create({ author: "bot", body: id + " has left the game" });
        })
        .catch((err) => {
          console.error(err);
        });
    } else if (command.startsWith("/peek")) {
      if (!games.hasOwnProperty(channel)) {
        sendPM({
          to: user,
          body: "Can't find a game to do this action...",
        });
        return;
      }
      clearTimeout(games[channel].timeLimit);
      games[channel].seerPeek(user.sid, args[0]);
    } else if (command.startsWith("/rob")) {
      if (!games.hasOwnProperty(channel)) {
        sendPM({
          to: user,
          body: "Can't find a game to do this action...",
        });
        return;
      }
      clearTimeout(games[channel].timeLimit);
      games[channel].robberRob(user.sid, args[0]);
    } else if (command.startsWith("/swap")) {
      if (!games.hasOwnProperty(channel)) {
        sendPM({
          to: user,
          body: "Can't find a game to do this action...",
        });
        return;
      }
      clearTimeout(games[channel].timeLimit);
      games[channel].troublemakerSwap(user.sid, args[0], args[1]);
    } else if (command == "/vote") {
      games[channel].lynchingVote(user.sid, args[0]);
    } else if (command == "/force-end") {
      if (!games.hasOwnProperty(channel)) {
        sendPM({
          to: user,
          body: "Can't find a game to end...",
        });
        return;
      }
      games[channel].forceEnd();
      delete games[channel];
    } else if (command == "/help") {
      sendHelpMessage(user);
    } else {
      // unhandled command
      sendHelpMessage(user);
    }
    // all commands are private
    return false;
  } // general chit-chat allowed
  return true;
};

function sendHelpMessage(user) {
  var helpMessage =
    "" +
    "• Anyone can chat `/start` in a conversation to start a new game. There can only be one game in-progress per conversation.\n" +
    "• You can also specify players by chatting `/start user1 user2 ...`, up to 8 players in total\n" +
    "• From an initial conversation you can `/join gameid` or `/create user1 user2 ...` to launch a new game\n" +
    "• Prior to a game starting you can invite/SMS people with `/invite address`. They will receive instructions on how to join\n" +
    "• SMS based users may wish to set their name with `/name [username]`\n" +
    "• A Seer can message `/peek center` to peek at 2 random (non-player) roles or `/peek user` to peek at a player's role\n" +
    "• A Robber can message `/rob user` to steal another player's role\n" +
    "• A Troublemaker can message `/swap user1 user2` to swap the roles of user1 and user2\n" +
    "• Anyone can chat `/vote user` to vote who will be lynched\n" +
    "• Anyone can chat `/force-end` to end a game prematurely\n" +
    "• Leave the game (and chat) with `/quit` at any time\n" +
    "• Typing `/help` will show this help message";
  sendPM({ to: user, body: helpMessage });
}
