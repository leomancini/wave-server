import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export default async (commentText, previousComments = []) => {
  try {
    // Strip the @Claude mention from the prompt text
    const prompt = commentText.replace(/@claude/gi, "").trim();

    if (!prompt) {
      return "Hey! You mentioned me but didn't ask anything. What's up?";
    }

    // Build context from previous comments on the post
    const context = previousComments
      .map((c) => `${c.user?.name || "Someone"}: ${c.comment}`)
      .join("\n");

    const userMessage = context
      ? `Here are the previous comments on this post for context:\n${context}\n\nNow someone is asking you:\n${prompt}`
      : prompt;

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      system:
        "You are Claude, a friendly AI participating in a group chat on a social app called WAVE. Keep your responses brief, casual, and helpful — like a friend in a group chat. One to three sentences max. Don't use markdown formatting.",
      messages: [
        {
          role: "user",
          content: userMessage
        }
      ]
    });

    return response.content[0].text;
  } catch (error) {
    console.error("Error generating Claude response:", error);
    return "Sorry, I couldn't come up with a response right now!";
  }
};
