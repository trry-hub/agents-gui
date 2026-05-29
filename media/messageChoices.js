(function (root, factory) {
  const dependency = typeof module === 'object' && module.exports
    ? require('./messageText.js')
    : root.AgentsGuiMessageText;
  const api = factory(dependency);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  root.AgentsGuiMessageChoices = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (messageText) {
  const normalizeMessageText = messageText.normalizeMessageText;
  const stripInlineMarkdown = messageText.stripInlineMarkdown;

  function extractMessageChoices(text, options = {}) {
    const source = normalizeMessageText(text);
    if (!source.trim()) {
      return [];
    }

    const promptForChoice = typeof options.promptForChoice === 'function'
      ? options.promptForChoice
      : (_index, label) => label;
    const choices = [];
    let hasExplicitChoiceLine = false;
    let inFence = false;
    for (const rawLine of source.split('\n')) {
      const trimmed = rawLine.trim();
      if (/^```/.test(trimmed)) {
        inFence = !inFence;
        continue;
      }
      if (inFence || !trimmed) {
        continue;
      }

      const cleaned = stripInlineMarkdown(trimmed)
        .replace(/^[-*+]\s+/, '')
        .replace(/^>\s+/, '')
        .replace(/^#{1,6}\s+/, '')
        .trim();
      const choice = parseMessageChoiceLine(cleaned);
      if (!choice) {
        continue;
      }

      const index = normalizeChoiceIndex(choice.index);
      const label = normalizeChoiceLabel(choice.label);
      if (!index || !label) {
        continue;
      }
      hasExplicitChoiceLine = hasExplicitChoiceLine || choice.explicit;

      choices.push({
        index,
        label,
        prompt: promptForChoice(index, label),
      });
      if (choices.length >= 5) {
        break;
      }
    }

    return choices.length >= 2 && (hasExplicitChoiceLine || hasMessageChoiceIntent(source)) ? choices : [];
  }

  function parseMessageChoiceLine(line) {
    const source = normalizeMessageText(line).trim();
    if (!source) {
      return undefined;
    }

    const explicit = /^(?:选项|方案|Option)\s*([0-9０-９一二三四五六七八九十①②③④⑤⑥⑦⑧⑨⑩]+)\s*(?:--|[—\-:：.、）)])\s*(.+)$/i.exec(source);
    if (explicit) {
      return { index: explicit[1], label: explicit[2], explicit: true };
    }

    const numbered = /^([0-9０-９一二三四五六七八九十①②③④⑤⑥⑦⑧⑨⑩]+)\s*(?:[.)、:：）])\s*(.+)$/.exec(source);
    if (numbered) {
      return { index: numbered[1], label: numbered[2], explicit: false };
    }

    const circled = /^([①②③④⑤⑥⑦⑧⑨⑩])\s+(.+)$/.exec(source);
    if (circled) {
      return { index: circled[1], label: circled[2], explicit: false };
    }

    return undefined;
  }

  function normalizeChoiceLabel(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/\s*(?:→|=>|->)\s*.+$/, '')
      .replace(/[。；;:：]+$/, '')
      .trim();
  }

  function hasMessageChoiceIntent(text) {
    const source = stripInlineMarkdown(normalizeMessageText(text))
      .replace(/\s+/g, ' ')
      .trim();
    if (!source) {
      return false;
    }

    return /(?:请选择|请\s*选择|选择(?:一个|以下|其中|下一步|方案|选项)|(?:你|您)?可以选择|需要(?:你|您)?选择|回复(?:序号|编号|数字|选项)|输入(?:序号|编号|数字|选项)|choose one|select one|pick one|reply with|which option)/i.test(source);
  }

  function normalizeChoiceIndex(value) {
    const text = String(value || '').trim();
    const circledMap = {
      '①': '1',
      '②': '2',
      '③': '3',
      '④': '4',
      '⑤': '5',
      '⑥': '6',
      '⑦': '7',
      '⑧': '8',
      '⑨': '9',
      '⑩': '10',
    };
    if (circledMap[text]) {
      return circledMap[text];
    }

    const fullWidth = '０１２３４５６７８９';
    const halfWidth = text.replace(/[０-９]/g, (char) => String(fullWidth.indexOf(char)));
    const cnMap = {
      一: '1',
      二: '2',
      三: '3',
      四: '4',
      五: '5',
      六: '6',
      七: '7',
      八: '8',
      九: '9',
      十: '10',
    };
    return cnMap[halfWidth] || halfWidth;
  }

  return {
    extractMessageChoices,
    hasMessageChoiceIntent,
    normalizeChoiceIndex,
    normalizeChoiceLabel,
    parseMessageChoiceLine,
  };
});
