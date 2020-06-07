# ultimate-werewolf-twilio

A Twilio Conversations bot that moderates Ultimate Werewolf games (3-8 players)

Forked from [yowmamasita/ultimate-werewolf-slack](https://github.com/yowmamasita/ultimate-werewolf-slack/) which was inspired by [chrisgillis/slackwolf](https://github.com/chrisgillis/slackwolf) but this one plays the [One Night Ultimate Werewolf](https://boardgamegeek.com/boardgame/147949/one-night-ultimate-werewolf) variation. 
Supported roles are: `Werewolf`, `Minion`, `Seer`, `Robber`, `Troublemaker`, `Drunk`, `Insomniac`, `Villager`. 
You can download the rulebook [here](https://drive.google.com/file/d/0BzzjKoXCqlyubTUxZFRPblFoMFU/view?usp=sharing).

## Running the bot

1. Copy .env.example to .env and fill in your environment details
2. Run it with `npm install` then `node app.js`

## Game Instructions

* Anyone can chat `/start` in a conversation to start a new game. There can only be one game in-progress per conversation.
* You can also specify players by chatting `/start user1 user2 ...`, up to 8 players in total
* From an initial conversation you can `/join gameid [username]` or `/create user1 user2 ...` to launch a new game
* Prior to a game starting you can invite/SMS people with `/invite address`. They will receive instructions on how to join
* SMS based users may wish to set their name with `/name [username]`
* A Seer can message `/peek center` to peek at 2 random (non-player) roles or `/peek user` to peek at a player's role
* A Robber can message `/rob user` to steal another player's role
* A Troublemaker can message `/swap user1 user2` to swap the roles of user1 and user2
* Anyone can chat `/vote user` to vote who will be lynched
* Anyone can chat `/force-end` to end a game prematurely
* Leave the game (and chat) with `/quit` at any time
* Typing `/help` will show this help message
