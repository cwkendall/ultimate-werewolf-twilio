const Router = require("express").Router;
const router = new Router();

const handler = require("./index");

require("dotenv").config();

const _ = require("lodash");

const Twilio = require("twilio");
const client = new Twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const global_webhook = {
  method: "POST",
  filters: ["onConversationAdd", "onMessageAdd", "onMessageAdded"],
  preWebhookUrl: process.env.PUBLIC_BASE_URL + "/global",
  postWebhookUrl: process.env.PUBLIC_BASE_URL + "/global",
};

// setup global webhooks if not already configured
client.conversations
  .webhooks()
  .fetch()
  .then((webhooks) => {
    console.log("Existing config: \n", webhooks);
    if (!webhooks || webhooks.length == 0) {
      console.error("error fetching webhooks");
    } else if (_.isMatch(webhooks, global_webhook)) {
      console.error("webhook already configured");
    } else {
      client.conversations
        .webhooks()
        .update(global_webhook)
        .then((res) => {
          console.log("global webhooks configured: \n", res);
        });
    }
  });

router.post("/global", (req, resp) => {
  console.log(req.body);
  const { EventType } = req.body;

  if (EventType === "onConversationAdd") {
    const { MessageBody } = req.body;
    const parts = MessageBody.toLowerCase().split(" ");
    const command = parts[0].toLowerCase();
    if (command === "/create" || command === "/start" || command === "/join") {
      resp.status(200).json({});
    } else {
      // todo reply with help text?
      // fixme do we need to audit number of conversations per user
      resp.sendStatus(400);
    }
  } else if (EventType === "onMessageAdd") {
    const { ConversationSid, ParticipantSid, Author, Body } = req.body;
    const messageAccepted = handler({
      text: Body,
      channel: ConversationSid,
      user: {
        sid: ParticipantSid,
        address: Author,
        proxy_address: process.env.SMS_NUMBER,
      },
    });
    // if it is a private message, block it from the conversation
    if (!messageAccepted) {
      resp.sendStatus(406);
      return;
    }
    resp.status(200).json({});
  } else if (EventType === "onMessageAdded") {
    const { ConversationSid, ParticipantSid, Author, Body } = req.body;
    const parts = Body.toLowerCase().split(" ");
    const command = parts[0].toLowerCase();
    if (command === "/create" || command === "/start" || command === "/join") {
      handler({
        text: Body,
        channel: ConversationSid,
        user: {
          sid: ParticipantSid,
          address: Author,
          proxy_address: process.env.SMS_NUMBER,
        },
      });
    }
    resp.status(200).json({});
  }
});

module.exports = router;
