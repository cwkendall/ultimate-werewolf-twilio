"use strict";

const SLOW = 10;
const MEDIUM = 5;
const FAST = 2;

let GAME_SPEED = process.env.SPEED > 0 ? process.env.SPEED : MEDIUM;

const TIME_LIMIT = 5 * GAME_SPEED * 1000;
const VOTING_PHASE = GAME_SPEED; // minutes
const REMINDERS = [
  GAME_SPEED * 12 * 1000,
  GAME_SPEED * 24 * 1000,
  GAME_SPEED * 36 * 1000,
  GAME_SPEED * 48 * 1000,
  GAME_SPEED * 54 * 1000,
];

const DECK = [
  "Werewolf",
  "Werewolf",
  "Minion",
  "Seer",
  "Robber",
  "Troublemaker",
  "Drunk",
  "Insomniac",
  "Villager",
  "Villager",
  "Villager",
];

const MESSAGES = {
  Game: {
    start: "*Everyone, close your eyes.*",
    end: "*Wake up!* Voting ends in " + VOTING_PHASE + " minutes. Type `/vote username` to vote.",
  },
  Werewolf: {
    start: "`Werewolves`, wake up and look for other werewolves.",
    end: "`Werewolves`, close your eyes.",
  },
  Minion: {
    start: "`Minion`, wake up. `Werewolves`, stick out your thumb so the `Minion` can see who you are.",
    end: "`Werewolves`, put your thumbs away. `Minion`, close your eyes.",
  },
  Seer: {
    start: "`Seer`, wake up. You may look at another player's card or two of the center cards.",
    end: "`Seer`, close your eyes.",
  },
  Robber: {
    start: "`Robber`, wake up. You may exchange your card with another player's card, and then view your new card.",
    end: "`Robber`, close your eyes.",
  },
  Troublemaker: {
    start: "`Troublemaker`, wake up. You may exchange cards between two other players.",
    end: "`Troublemaker`, close your eyes.",
  },
  Drunk: {
    start: "`Drunk`, wake up and exchange your card with a card from the center.",
    end: "`Drunk`, close your eyes.",
  },
  Insomniac: {
    start: "`Insomniac`, wake up and look at your card",
    end: "`Insomniac`, close your eyes.",
  },
};

function randomDelay() {
  return (Math.random() * GAME_SPEED + 5) * 1000;
}

class Game {
  constructor(chatClient, channel) {
    this.gameID = channel.substr(2, 5);
    this.client = chatClient;
    this.channel = channel;
    this.currentTurn = "Beginning";
    this.players = [];
    this.roleDeck = [];
    this.origRoles = {};
    this.roles = {};
    this.nextStep = Promise.resolve;
    this.timeLimit = null;
    this.votes = {};
    this.tally = {};

    this.identities = {};

    this.client.sendMsg = (channel, message) => {
      this.client.conversations
        .conversations(channel)
        .messages.create({
          author: "bot",
          body: message,
        })
        .catch((err) => {
          console.error(err);
        });
    };

    this.client.sendPM = ({ to, body, media }) => {
      // console.log("SENDING PM", to, body);
      // todo support chat PM
      this.client.conversations
        .conversations(this.channel)
        .participants(to.sid)
        .fetch()
        .then((p) => {
          this.client.messages
            .create({
              from: to.proxy_address,
              to: to.address,
              body: "[private]: " + body,
              ...(media && { mediaUrl: media })
            })
            .catch((err) => {
              console.error(err);
            });
        })
        .catch((err) => {
          console.err(
            "User <" + to.identity + "> has left the game [" + this.gameID + "], supressing all private messages"
          );
        });
    };

    // announce GameID
    let announce = "A new game of *Ultimate Werewolf*, GameID [" + this.gameID + "]";
    this.client.sendMsg(this.channel, announce);
  }

  addPlayers(new_players = []) {
    console.log("addPlayers", new_players);
    this.players = [];
    return new Promise((resolve, reject) => {
      this.client.conversations
        .conversations(this.channel)
        .participants.list()
        .then((participants) => {
          for (let party of participants) {
            console.log(party);
            if (party.messagingBinding) {
              // messaging
              const idx = new_players.indexOf(party.messagingBinding.address);
              if (idx >= 0) {
                new_players.splice(idx, 1);
              }
            }
            if (party.identity) {
              // chat identities
              const idx = new_players.indexOf(party.identity);
              if (idx >= 0) {
                new_players.splice(idx, 1);
              }
            }
            // check if in channel but not in list of players
            // add back in all existing players (will prune any that left)
            console.log("added existing party: ", party.sid);
            this.players.push(party.sid);
            if (!this.identities[party.sid]) {
              this.identities[party.sid] = {
                ...(party.messagingBinding && { ...party.messagingBinding }),
                ...(party.identity ? { identity: party.identity } : { identity: party.messagingBinding.address }),
                sid: party.sid,
              };
            }
            console.log("identity: ", this.identities[party.sid]);
          }
          console.log("current players: ", this.players);

          // add all new players to conversation
          this.players = this.players.concat(
            new_players.map((player) => {
              if (player.startsWith("+") || player.startsWith("messenger:") || player.startsWith("whatsapp:")) {
                return this.client.conversations
                  .conversations(this.channel)
                  .participants.create({
                    "messagingBinding.address": player,
                    "messagingBinding.proxyAddress": process.env.SMS_NUMBER,
                  })
                  .then((v) => {
                    this.identities[v.sid] = {
                      ...(v.messagingBinding && { ...v.messagingBinding }),
                      ...(v.identity ? { identity: v.identity } : { identity: v.messagingBinding.address }),
                      sid: v.sid,
                    };
                    return v.sid;
                  });
              }
              // else {  // chat users
              //   return this.client.conversations
              //     .conversations(this.channel)
              //     .participants.create({ identity: player }).then((v) => {
              //     this.identities[v.sid] = {
              //       identity: v.identity,
              //       sid: v.sid,
              //     };
              //     return v.sid;
              //   });
              // }
            })
          );
          resolve(this.players);
        });
    });
  }

  start(new_players) {
    this.addPlayers(new_players).then(() => {
      this.getPlayers();
      this.announceRoles();
      this.delegateRoles();
      this.announcePlayerRole();
      // We're ready to start the night!
      this.asyncDelay(this.startNight);
    });
  }

  getPlayers() {
    console.log("players: ", this.players);
    console.log("identities: ", this.identities);

    this.players = this.players.slice(0, DECK.length - 3);
    let announce =
      "The players (" +
      this.players.length +
      "): <" +
      Object.values(this.identities)
        .filter((i) => this.players.includes(i.sid))
        .map((j) => (j.identity ? j.identity : j.address))
        .join(">, <") +
      ">";
    this.client.sendMsg(this.channel, announce);
  }

  announceRoles() {
    // announce roles to all players
    this.roleDeck = DECK.slice(0, this.players.length + 3);
    let announce = "The roles: `" + this.roleDeck.join("`, `") + "`";
    this.client.sendMsg(this.channel, announce);
  }

  delegateRoles() {
    shuffle(this.roleDeck);
    this.players.forEach((player, i) => (this.origRoles[player] = this.roleDeck[i]));
    this.roles = Object.assign({}, this.origRoles);
  }

  announcePlayerRole() {
    // send out the roles via PM
    Object.keys(this.origRoles).forEach((player) =>
      this.sendPMInGame(player, "Your role is `" + this.origRoles[player] + "`!",
        process.env.PUBLIC_BASE_URL + "/images/" + this.origRoles[player].toLowerCase() + ".png")
    );
  }

  startNight() {
    return this.asyncDelay(this.sendStartMessage, "Game")
      .then(
        function () {
          return this.wakeUp("Werewolf");
        }.bind(this)
      )
      .then(
        function () {
          return this.wakeUp("Minion");
        }.bind(this)
      )
      .then(
        function () {
          return this.wakeUp("Seer");
        }.bind(this)
      )
      .then(
        function () {
          return this.wakeUp("Robber");
        }.bind(this)
      )
      .then(
        function () {
          return this.wakeUp("Troublemaker");
        }.bind(this)
      )
      .then(
        function () {
          return this.wakeUp("Drunk");
        }.bind(this)
      )
      .then(
        function () {
          return this.wakeUp("Insomniac");
        }.bind(this)
      )
      .then(
        function () {
          return this.asyncDelay(this.sendEndMessage, "Game");
        }.bind(this)
      )
      .then(
        function () {
          return this.beginVoting();
        }.bind(this)
      );
  }

  wakeUp(role) {
    this.currentTurn = role + "'s turn";

    // Role not included in the game
    if (this.roleDeck.indexOf(role) < 0) return Promise.resolve();

    return this.asyncDelay(this.sendStartMessage, role)
      .then(
        function () {
          return this.initiateRoleSequence(role);
        }.bind(this)
      )
      .then(
        function () {
          return this.asyncDelay(this.sendEndMessage, role);
        }.bind(this)
      );
  }

  beginVoting() {
    this.currentTurn = "Voting Phase";
    setTimeout(
      function () {
        if (this.currentTurn == "End") {
          return;
        }
        this.client.sendMsg(this.channel, "*Time's up!*");
        this.currentTurn = "End";
        this.showResults(true);
      }.bind(this),
      VOTING_PHASE * 60 * 1000
    );
    REMINDERS.forEach((t) =>
      setTimeout(
        function () {
          if (this.currentTurn == "End") {
            return;
          }
          this.remindVoters(t);
        }.bind(this),
        t
      )
    );
    return Promise.resolve();
  }

  remindVoters(elapsedTime) {
    this.client.sendMsg(
      this.channel,
      "Remaining time to vote: `" + Math.round((VOTING_PHASE - elapsedTime / 60000)*100)/100 + " minutes`. Type `/vote username` to vote."
    );
    this.showResults(false);
  }

  showResults(showWinner) {
    let nonVoters = this.players.filter((player) => Object.keys(this.votes).indexOf(player) < 0);
    let votedPlayers = Object.keys(this.tally);

    // Do not show anything if no votes have been received
    if (!votedPlayers.length) {
      this.client.sendMsg(this.channel, "No votes received yet...");
      if (showWinner) this.client.sendMsg(this.channel, "*You are all losers!*");
      return;
    }

    let toBeLynched = votedPlayers.reduce(
      function (previousPlayer, currentPlayer) {
        return this.clincher(previousPlayer, currentPlayer);
      }.bind(this)
    );

    // Show tally
    this.client.sendMsg(
      this.channel,
      "Player with the most number of votes: <" + this.identities[toBeLynched].identity + "> (" + this.tally[toBeLynched].length + ")"
    );
    let tallyText = [];
    for (var player of votedPlayers) {
      if (player == toBeLynched) continue;
      tallyText.push("<" + this.identities[player].identity + "> has " + this.tally[player].length + " votes");
    }
    if (tallyText.length) {
      this.client.sendMsg(this.channel, "Other players: " + tallyText.join(", "));
    }

    if (!showWinner) {
      if (nonVoters.length) {
        this.client.sendMsg(this.channel, "_These players have not voted yet:_ <" + nonVoters.map(v=>this.identities[v].identity).join(">, <") + ">");
      }
    } else {
      this.client.sendMsg(this.channel, "<" + this.identities[toBeLynched].identity + "> is a... `" + this.roles[toBeLynched] + "`!");
      let cast = [];
      Object.keys(this.roles).forEach(
        function (player) {
          cast.push("<" + this.identities[player].identity + "> is the `" + this.roles[player] + "`");
        }.bind(this)
      );
      this.client.sendMsg(this.channel, cast.join(", "));
      if (this.roles[toBeLynched] == "Werewolf") {
        this.winner = "Village Team";
        this.winningPlayers = Object.keys(this.roles).filter(
          (player) => ["Werewolf", "Minion"].indexOf(this.roles[player]) < 0
        );
      } else {
        this.winner = "Werewolf Team";
        this.winningPlayers = Object.keys(this.roles).filter(
          (player) => ["Werewolf", "Minion"].indexOf(this.roles[player]) >= 0
        );
      }
      this.client.sendMsg(this.channel, "Winner: *" + this.winner + "* <" + this.winningPlayers.map(w=>this.identities[w].identity).join(">, <") + ">");
      if (nonVoters.length) {
        this.client.sendMsg(
          this.channel,
          "_These players did not vote:_ <" + nonVoters.map((v) => this.identities[v].identity).join(">, <") + ">"
        );
      }
    }
  }

  clincher(previousPlayer, currentPlayer) {
    if (this.tally[previousPlayer].length > this.tally[currentPlayer].length) {
      return previousPlayer;
    } else if (this.tally[previousPlayer].length < this.tally[currentPlayer].length) {
      return currentPlayer;
    } else {
      return Math.random() < 0.5 ? previousPlayer : currentPlayer;
    }
  }

  sendStartMessage(role) {
    this.client.sendMsg(this.channel, MESSAGES[role].start);
  }

  sendEndMessage(role) {
    this.client.sendMsg(this.channel, MESSAGES[role].end);
  }

  initiateRoleSequence(role) {
    return new Promise(
      function (resolve, reject) {
        this.nextStep = resolve;
        let playersThisTurn = this.filterPlayersByOriginalRole(role);
        if (playersThisTurn.length) {
          playersThisTurn.forEach(
            function (player) {
              this.sendPMInGame(player, "Your turn...");
              this.executePlayerTurn(player, this.origRoles[player]);
            }.bind(this)
          );
        } else {
          setTimeout(
            function () {
              this.nextStep();
            }.bind(this),
            randomDelay()
          );
        }
      }.bind(this)
    );
  }

  filterPlayersByOriginalRole(role) {
    return Object.keys(this.origRoles).filter((player) => role === this.origRoles[player]);
  }

  sendPMInGame(to, message, media) {
    const recipient = this.identities[to];
    // console.log("SENDING PM IN GAME", recipient, to, message);
    this.client.sendPM({
      to: recipient,
      body: message,
      media: media
    });
  }

  executePlayerTurn(player, role) {
    if (role == "Werewolf") {
      let werewolves = this.filterPlayersByOriginalRole("Werewolf");
      if (werewolves.length > 1) {
        // give a list of werewolves
        this.sendPMInGame(player, "Werewolves: <" + werewolves.map(w=>this.identities[w].identity).join("> & <") + ">");
      } else {
        // peek at center
        let center_idx = Math.floor(Math.random() * 3) + this.players.length;
        this.sendPMInGame(player, "You are the only werewolf, center peek: `" + this.roleDeck[center_idx] + "`");
      }
      this.nextStep();
    } else if (role == "Minion") {
      let werewolves = this.filterPlayersByOriginalRole("Werewolf");
      if (werewolves.length) {
        this.sendPMInGame(
          player,
          "Werewolves: <" + werewolves.map((w) => this.identities[w].identity).join("> & <") + ">"
        );
      } else {
        this.sendPMInGame(player, "Werewolves: _None_, survive on your own!");
      }
      this.nextStep();
    } else if (role == "Seer") {
      this.sendPMInGame(
        player,
        "`/peek center` to peek at 2 center cards or `/peek username` to peek at a player's card"
      );
      let you = this.players.indexOf(player);
      let players = this.players.slice();
      players.splice(you, 1);
      if (players.length) {
        this.sendPMInGame(
          player,
          "The players are: <" + players.map((p) => this.identities[p].identity).join(">, <") + ">"
        );
      }

      this.timeLimit = setTimeout(
        function () {
          if (this.currentTurn == "End") {
            return;
          }
          let target = "center";
          // Roll two-face dice
          if (players.length && Math.random() < 0.5 ? false : true) {
            target = players[Math.floor(Math.random() * players.length)];
          }
          this.sendPMInGame(player, "*Time limit reached!* Randomly choosing an action...");
          this.seerPeek(player, this.identities[target].identity);
        }.bind(this),
        TIME_LIMIT
      );
    } else if (role == "Robber") {
      this.sendPMInGame(player, "`/rob username` to rob a player");
      let you = this.players.indexOf(player);
      let players = this.players.slice();
      players.splice(you, 1);
      if (players.length) {
        this.sendPMInGame(player, "The players are: <" + players.map(p=>this.identities[p].identity).join(">, <") + ">");
      }

      this.timeLimit = setTimeout(
        function () {
          if (!players.length || this.currentTurn == "End") {
            // this.nextStep();
            return;
          }
          let target = players[Math.floor(Math.random() * players.length)];
          this.sendPMInGame(player, "*Time limit reached!* Randomly choosing an action...");
          this.robberRob(player, this.identities[target].identity);
        }.bind(this),
        TIME_LIMIT
      );
    } else if (role == "Troublemaker") {
      this.sendPMInGame(player, "`/swap userA userB` to swap the players' cards");
      let you = this.players.indexOf(player);
      let players = this.players.slice();
      players.splice(you, 1);
      if (players.length) {
        this.sendPMInGame(player, "The players are: <" + players.map(p=>this.identities[p].identity).join(">, <") + ">");
      }

      this.timeLimit = setTimeout(
        function () {
          if (!players.length || this.currentTurn == "End") {
            // this.nextStep();
            return;
          }
          let target1, target2;
          do {
            target1 = players[Math.floor(Math.random() * players.length)];
            target2 = players[Math.floor(Math.random() * players.length)];
          } while (target1 == target2);
          this.sendPMInGame(player, "*Time limit reached!* Randomly choosing an action...");
          this.troublemakerSwap(player, this.identities[target1].identity, this.identities[target2].identity);
        }.bind(this),
        TIME_LIMIT
      );
    } else if (role == "Drunk") {
      let center_idx = Math.floor(Math.random() * 3) + this.players.length;
      let newRole = this.roleDeck[center_idx];
      let oldRole = this.roles[player];
      this.roleDeck[center_idx] = oldRole;
      this.roles[player] = newRole;
      this.sendPMInGame(player, "Your card has been swapped to the center");
      this.nextStep();
    } else if (role == "Insomniac") {
      this.sendPMInGame(player, "Your card is...`" + this.roles[player] + "`");
      this.nextStep();
    }
  }

  seerPeek(sender, target) {
    // role check
    if (this.origRoles[sender] != "Seer") {
      this.sendPMInGame(sender, "Hey, you're not a Seer!");
      this.client.sendMsg(this.channel, "<" + this.identities[sender].identity + "> is trying to be a Seer!");
      return;
    }

    // check current turn
    if (!this.currentTurn.startsWith("Seer")) {
      this.sendPMInGame(sender, "This is not the right time");
      return;
    }

    // peek 2 cards center
    if (target && target.toLowerCase() == "center") {
      let center_idx1 = -1;
      let center_idx2 = -1;
      do {
        center_idx1 = Math.floor(Math.random() * 3) + this.players.length;
        center_idx2 = Math.floor(Math.random() * 3) + this.players.length;
      } while (center_idx1 == center_idx2);
      this.sendPMInGame(
        sender,
        "Center peek: `" + this.roleDeck[center_idx1] + "`, `" + this.roleDeck[center_idx2] + "`"
      );
    }

    // peek player card
    else {
      console.log("seer target:", target);
      target = Object.values(this.identities).find((t) => t.identity == target) || { identity: target};
      if (this.players.indexOf(target.sid) < 0) {
        this.sendPMInGame(sender, "There are no players with that username: <" + target.identity + ">");
        return;
      }
      this.sendPMInGame(sender, "<" + target.identity + ">'s card is `" + this.roles[target.sid] + "`");
    }
    this.nextStep();
  }

  robberRob(sender, target) {
    // role check
    if (this.origRoles[sender] != "Robber") {
      this.sendPMInGame(sender, "Hey, you're not a Robber!");
      this.client.sendMsg(this.channel, "<" + this.identities[sender].identity + "> is trying to be a Robber!");
      return;
    }

    // check current turn
    if (!this.currentTurn.startsWith("Robber")) {
      this.sendPMInGame(sender, "This is not the right time");
      return;
    }

    target = Object.values(this.identities).find((t) => t.identity == target) || { identity: target };
    if (this.players.indexOf(target.sid) < 0) {
      this.sendPMInGame(sender, "There are no players with that username: <" + target.identity + ">");
      return;
    }
    let oldRole = this.roles[sender];
    let newRole = this.roles[target.sid];
    this.roles[sender] = newRole;
    this.roles[target.sid] = oldRole;
    this.sendPMInGame(sender, "You robbed <" + target.identity + "> and your new role is `" + this.roles[sender] + "`");
    this.nextStep();
  }

  troublemakerSwap(sender, target1, target2) {
    // role check
    if (this.origRoles[sender] != "Troublemaker") {
      this.sendPMInGame(sender, "Hey, you're not a Troublemaker!");
      this.client.sendMsg(this.channel, "<" + this.identities[sender].identity + "> is trying to be a Troublemaker!");
      return;
    }

    // check current turn
    if (!this.currentTurn.startsWith("Troublemaker")) {
      this.sendPMInGame(sender, "This is not the right time");
      return;
    }

    if (target1 == target2) {
      this.sendPMInGame(sender, "You can't swap this player's card with his own");
      return;
    }

    target1 = Object.values(this.identities).find((t) => t.identity == target1) || { identity: target};
    if (this.players.indexOf(target1.sid) < 0) {
      this.sendPMInGame(sender, "There are no players with that username: <" + target1.identity + ">");
      return;
    }
    target2 = Object.values(this.identities).find((t) => t.identity == target2) || { identity: target };
    if (this.players.indexOf(target2.sid) < 0) {
      this.sendPMInGame(sender, "There are no players with that username: <" + target2.identity + ">");
      return;
    }
    let role1 = this.roles[target1.sid];
    let role2 = this.roles[target2.sid];
    this.roles[target1.sid] = role2;
    this.roles[target2.sid] = role1;
    this.sendPMInGame(sender, "You swapped <" + target1.identity + ">'s and <" + target2.identity + ">'s cards");
    this.nextStep();
  }

  lynchingVote(sender, target) {
    // check current turn
    if (!this.currentTurn.startsWith("Voting")) {
      this.client.sendMsg(this.channel, "This is not the right time");
      return;
    }

    target = Object.values(this.identities).find((t) => t.identity == target) || { identity: target };
    if (this.players.indexOf(target.sid) < 0) {
      this.client.sendMsg(this.channel, "There are no players with that username: <" + target.identity + ">");
      return;
    }

    if (this.votes.hasOwnProperty(sender)) {
      let vote = this.votes[sender];
      if (vote != target.sid) {
        let voter_idx = this.tally[vote].indexOf(sender);
        this.tally[vote].splice(voter_idx, 1);
      }
    }

    this.votes[sender] = target.sid;

    if (!this.tally.hasOwnProperty(target.sid)) {
      this.tally[target.sid] = [];
    }
    this.tally[target.sid].push(sender);
    this.client.sendMsg(
      this.channel,
      "<" +
        this.identities[sender].identity +
        "> voted for <" +
        target.identity +
        ">" +
        ", the player has " +
        this.tally[target.sid].length +
        " vote(s) now"
    );
  }

  forceEnd() {
    this.client.sendMsg(this.channel, "_Game was forced to end_");
    this.currentTurn = "End";
  }

  asyncDelay(fn) {
    let args = Array.prototype.slice.call(arguments, this.asyncDelay.length);
    return new Promise(
      function (resolve, reject) {
        setTimeout(
          function () {
            if (this.currentTurn == "End") {
              // resolve();
              return;
            }
            fn.apply(this, args);
            resolve();
          }.bind(this),
          randomDelay()
        );
      }.bind(this)
    );
  }
}

function shuffle(array) {
  var counter = array.length,
    temp,
    index;
  while (counter > 0) {
    index = Math.floor(Math.random() * counter);
    counter--;
    temp = array[counter];
    array[counter] = array[index];
    array[index] = temp;
  }
  return array;
}

module.exports = Game;
