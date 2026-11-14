// The Anthropic API key, read from ANTHROPIC_API_KEY or, failing that,
// AGORA_ANTHROPIC_API_KEY. Claude Code cloud sessions reserve ANTHROPIC_API_KEY
// for their own connection and drop it from the shell, so a key meant for the
// app (and for `npm run eval`) has to go in under the second name there.
export const apiKey = () => process.env.ANTHROPIC_API_KEY || process.env.AGORA_ANTHROPIC_API_KEY || undefined;
