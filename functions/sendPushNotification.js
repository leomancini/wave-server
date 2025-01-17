import webpush from "web-push";
import fs from "fs";
import path from "path";

export default async (groupId, userId, { title, body }) => {
  try {
    const subscriptionsPath = path.join(
      "groups",
      groupId,
      "notifications",
      "subscriptions",
      "web-push.json"
    );

    if (!fs.existsSync(subscriptionsPath)) {
      return {
        success: false,
        error: "No subscriptions found"
      };
    }

    const subscriptions = JSON.parse(
      fs.readFileSync(subscriptionsPath, "utf8")
    );
    const userSubscription = subscriptions[userId];

    if (!userSubscription) {
      return {
        success: false,
        error: "User subscription not found"
      };
    }

    const payload = JSON.stringify({
      title,
      body,
      timestamp: Date.now()
    });

    try {
      await webpush.sendNotification(userSubscription.subscription, payload);
      return {
        success: true,
        message: "Test notification sent successfully"
      };
    } catch (error) {
      if (
        error.statusCode === 410 ||
        error.body?.includes("unsubscribed or expired")
      ) {
        delete subscriptions[userId];
        fs.writeFileSync(
          subscriptionsPath,
          JSON.stringify(subscriptions, null, 2)
        );
        return {
          success: false,
          error: "Subscription has expired",
          isExpired: true
        };
      }
      throw error;
    }
  } catch (error) {
    console.error("Error sending test notification:", error);
    return {
      success: false,
      error: error.message
    };
  }
};
