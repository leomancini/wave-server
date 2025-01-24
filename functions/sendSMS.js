import dotenv from "dotenv";
import twilio from "twilio";

dotenv.config();

export default (recipientPhoneNumber, message) => {
  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );

  client.messages.create({
    from: process.env.TWILIO_PHONE_NUMBER,
    to: recipientPhoneNumber,
    body: message
  });
};
