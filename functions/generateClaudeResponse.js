import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export default async (commentText, previousComments = [], { groupId, users = [], stats = {} } = {}) => {
  try {
    // Strip the @Claude mention from the prompt text
    const prompt = commentText.replace(/@claude/gi, "").trim();

    if (!prompt) {
      return "hey! you mentioned me but didn't ask anything. what's up?";
    }

    // Build context from previous comments on the post
    const context = previousComments
      .map((c) => `${c.user?.name || "Someone"}: ${c.comment}`)
      .join("\n");

    // Build group member list (excluding Claude)
    const memberNames = users
      .filter((u) => u.id !== "claude-ai" && !u.isDuplicate)
      .map((u) => u.name);

    // Build stats context
    const statsContext = [];
    if (stats.userCount) statsContext.push(`${stats.userCount} members`);
    if (stats.mediaCount) statsContext.push(`${stats.mediaCount} posts`);
    if (stats.totalReactions) statsContext.push(`${stats.totalReactions} total reactions`);
    if (stats.totalComments) statsContext.push(`${stats.totalComments} total comments`);
    if (stats.topReactions && stats.topReactions.length > 0) {
      statsContext.push(`top reactions: ${stats.topReactions.map((r) => `${r.reaction} (${r.count})`).join(", ")}`);
    }

    let userMessage = "";

    if (context) {
      userMessage += `here are the previous comments on this post for context:\n${context}\n\n`;
    }

    userMessage += `now someone is asking you:\n${prompt}`;

    const groupName = groupId || "unknown";
    const memberList = memberNames.length > 0 ? memberNames.join(", ") : "unknown";
    const statsInfo = statsContext.length > 0 ? statsContext.join(", ") : "no stats available";

    const systemPrompt = `you are claude, a friendly AI participating in a group chat on a social app called WAVE. you always talk in all lowercase. keep your responses brief, casual, and helpful — like a friend in a group chat. one to three sentences max. don't use markdown formatting.

you are in a group called "${groupName}". the members of this group are: ${memberList}. group stats: ${statsInfo}.

you can @mention people in this group by typing @Name (e.g. @${memberNames[0] || "someone"}). use @mentions when it makes sense, like when referring to someone, answering a question about someone, or looping someone into the conversation. don't overdo it though — only mention people when it's natural and relevant.`;

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      system: systemPrompt,
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
    return "sorry, i couldn't come up with a response right now!";
  }
};
