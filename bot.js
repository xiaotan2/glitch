'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const request = require('request');
const path = require('path');
var messengerButton = "<html><head><title>Facebook Messenger Bot</title></head><body><h1>Facebook Messenger Bot</h1>This is a bot based on Messenger Platform QuickStart. For more details, see their <a href=\"https://developers.facebook.com/docs/messenger-platform/guides/quick-start\">docs</a>.<script src=\"https://button.glitch.me/button.js\" data-style=\"glitch\"></script><div class=\"glitchButton\" style=\"position:fixed;top:20px;right:20px;\"></div></body></html>";

let app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true
}));

var mongoDB = require('./mongoDBAdaptor').sync;
mongoDB.initializeApp(app);

// Webhook validation
app.get('/webhook', function(req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
    console.log("Validating webhook");
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.error("Failed validation. Make sure the validation tokens match.");
    res.sendStatus(403);          
  }
});

// Display the web page
app.get('/', function(req, res) {
  res.writeHead(200, {'Content-Type': 'text/html'});
  res.write(messengerButton);
  res.end();
});

// Post a intent-response pair to mongoDB
app.post('/intent', function(req, res) {
  console.log(req.body);
  var data = req.body;
  
  if(data.object === 'intent') {
    var intent = data.intent;
    var response = data.response;
    mongoDB.connect();
    mongoDB.set(intent, response);
  }
  res.sendStatus(200);
});

// Message processing
app.post('/webhook', function (req, res) {
  console.log(req.body);
  var data = req.body;

  // Make sure this is a page subscription
  if (data.object === 'page') {
    
    // Iterate over each entry - there may be multiple if batched
    data.entry.forEach(function(entry) {
      var pageID = entry.id;
      var timeOfEvent = entry.time;

      // Iterate over each messaging event
      // We must send back status 200 to signal callback received
      entry.messaging.forEach(function(event) {
        if (event.message) {
          receivedMessage(event);
        } else if (event.postback) {
          receivedPostback(event); 
        } else {
          console.log("Webhook received unknown event: ", event);
        }
      });
    });

    // Assume all went well.
    //
    // You must send back a 200, within 20 seconds, to let us know
    // you've successfully received the callback. Otherwise, the request
    // will time out and we will keep trying to resend.
    res.sendStatus(200);
  }
});

// Incoming events handling
function receivedMessage(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfMessage = event.timestamp;
  var message = event.message;

  console.log("Received message for user %d and page %d at %d with message:", 
    senderID, recipientID, timeOfMessage);
  console.log(JSON.stringify(message));

  var messageId = message.mid;

  var messageText = message.text;
  var messageAttachments = message.attachments;
  var messageNlp = message.nlp;

  if (messageText) {
    var response = constructResponse(messageNlp);
    // we are not certain what user is asking, so we ask user
    if(response.charAt(0) == '?') {
      sendInquiryMessage(senderID, response.substr(1, response.length-1));
    }
    else {
      sendTextMessage(senderID, response);
    }
    
  } else if (messageAttachments) {
    sendTextMessage(senderID, "Message with attachment received");
  }
}

function constructResponse(messageNlp) {
  var entities = messageNlp.entities;
  // empty entities means NLP fail to interpret user intent
  if(!entities) {
    console.log("NLP can't identify user's request.");
    return "I'm sorry, I don't understand your question. :(";
  }
  var response = "";
  // greetings
  if(entities.greetings) {
    if(entities.greetings[0].confidence > 0.9 && entities.greetings[0].value == "true") {
      response += "Hello. ";
    }
  }
  // intent
  if(entities.intent) {
    // very certain this is what user is asking
    if(entities.intent[0].confidence >= 0.9) {
      mongoDB.connect();
      var ret = mongoDB.get(entities.intent[0].value);
      if(ret) {
        response += ret;
      }
    }
    // medium level confidence, ask user
    else if(entities.intent[0].confidence >= 0.7) {
      return "?" + entities.intent[0].value;
    }
  }
  // bye
  if(entities.bye) {
    if(entities.bye[0].confidence > 0.9 && entities.bye[0].value == "true") {
      response = "Have a great day!";
    }
  }
  // empty response means NLP is not confident about its interpretation of user intent
  if(response == "") {
    response = "I'm sorry, I don't understand your question. :(";
  }
  console.log("Response will be %s", response);
  return response;
}

function receivedPostback(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfPostback = event.timestamp;

  var payload = event.postback.payload;

  console.log("Received postback for user %d and page %d with payload '%s' " + 
    "at %d", senderID, recipientID, payload, timeOfPostback);
  
  // User says the intent is what they are asking for, so reply and update
  if(payload != "No") {
    mongoDB.connect();
    var ret = mongoDB.get(payload);
    if(ret) {
      sendTextMessage(senderID, ret);
    }
    // perhaps here we can update wit.ai with this question to improve data quality.
  }
  else {
    sendTextMessage(senderID, "Excuse me. Do you have more questions?");
  }
}

//////////////////////////
// Sending helpers
//////////////////////////
function sendTextMessage(recipientId, messageText) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: messageText
    }
  };

  callSendAPI(messageData);
}

function sendInquiryMessage(recipientId, intent) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "You ask a good question, because I'm not sure what you are asking. Are you asking about " + intent + "? ",           
          buttons: [{
            type: "postback",
            title: "Yes",
            payload: intent
          }, 
          {
            type: "postback",
            title: "No",
            payload: "No"
          }]
        }
      }
    }
  };  

  callSendAPI(messageData);
}

function callSendAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: process.env.PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: messageData

  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var recipientId = body.recipient_id;
      var messageId = body.message_id;

      console.log("Successfully sent generic message with id %s to recipient %s", 
        messageId, recipientId);
    } else {
      console.error("Unable to send message.");
      console.error(response);
      console.error(error);
    }
  });  
}

// Set Express to listen out for HTTP requests
var server = app.listen(process.env.PORT || 3000, function () {
  console.log("Listening on port %s", server.address().port);
});