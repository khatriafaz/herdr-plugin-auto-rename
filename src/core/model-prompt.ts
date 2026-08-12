export const NAMING_SYSTEM_PROMPT = `You name coding tasks. Return only one compact JSON object with this schema:
{"title":"Human readable title","kind":"feature|fix|refactor|docs|test|chore|explore","slug":"git-safe-kebab-case"}
The title must describe the concrete outcome in at most 7 words. Never copy the user's sentence verbatim. Convert questions and requests for explanation into concise action-oriented noun or verb phrases. Do not use question words, first-person pronouns, or trailing punctuation. For example, "what is this project about?" becomes title "Understand project purpose", kind "explore", slug "understand-project-purpose". The slug must be at most 7 words. Do not include a branch prefix in slug.`;

export function boundedPrompt(prompt: string, maxLength = 6000): string {
	if (prompt.length <= maxLength) return prompt;
	const marker = "\n\n[earlier session content omitted]\n\n";
	const available = maxLength - marker.length;
	const headLength = Math.floor(available / 2);
	return prompt.slice(0, headLength) + marker + prompt.slice(-(available - headLength));
}

export function namingRequestPrompt(prompt: string): string {
	return `${NAMING_SYSTEM_PROMPT}\n\nTask description:\n${boundedPrompt(prompt)}`;
}
