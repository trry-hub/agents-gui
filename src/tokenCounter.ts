import { AssistantContextSnapshot, AssistantTokenUsage } from './assistantTypes';
import { CliProfile, CliTokenizerConfig, inferTokenizerFromModelId } from './cliProfiles';
import { renderAssistantContext } from './promptBuilder';

export function countContextTokens(
  snapshot: AssistantContextSnapshot,
  profile: CliProfile,
  modelId?: string
): AssistantTokenUsage {
  const tokenizer = profile.tokenizer ?? inferTokenizerFromModelId(modelId);
  const text = renderAssistantContext(snapshot);

  return {
    precision: 'estimated',
    tokens: estimateTextTokens(text, tokenizer),
    tokenizer: tokenizer ? `${tokenizer.label} estimate` : 'Generic estimate',
  };
}

export function estimateTextTokens(text: string, tokenizer?: CliTokenizerConfig): number {
  if (!text.trim()) {
    return 0;
  }

  let asciiChars = 0;
  let cjkChars = 0;
  let otherChars = 0;
  let structuralChars = 0;

  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) {
      asciiChars += 1;
      if (/\w/.test(char) === false && /\s/.test(char) === false) {
        structuralChars += 1;
      }
      continue;
    }
    if (isCjkCodePoint(codePoint)) {
      cjkChars += 1;
      continue;
    }
    otherChars += 1;
  }

  const asciiCharsPerToken = tokenizer?.provider === 'anthropic'
    ? 3.7
    : tokenizer?.provider === 'openai' && tokenizer.encoding === 'cl100k_base'
      ? 3.8
      : 4;
  const asciiTokens = asciiChars / asciiCharsPerToken;
  const cjkTokens = cjkChars * 0.95;
  const otherTokens = otherChars * 0.6;
  const structureTokens = structuralChars * 0.18;

  return Math.max(1, Math.ceil(asciiTokens + cjkTokens + otherTokens + structureTokens));
}

function isCjkCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x3400 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0x3040 && codePoint <= 0x30ff) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af)
  );
}
