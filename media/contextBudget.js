(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.AgentsGuiContextBudget = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function formatTokenCount(tokens) {
    const value = toSafeTokenCount(tokens);
    if (value < 1000) {
      return String(value);
    }
    if (value >= 1000000) {
      return formatScaledCount(value, 1000000, 'm');
    }
    return formatScaledCount(value, 1000, 'k');
  }

  function formatPercentage(percent) {
    const value = Number(percent);
    if (!Number.isFinite(value) || value <= 0) {
      return '0';
    }
    if (value < 0.1) {
      return '<0.1';
    }
    if (value < 1) {
      return String(Math.round(value * 10) / 10);
    }
    return String(Math.round(value));
  }

  function deriveContextBudgetPresentation(options) {
    const tokenUsage = options?.tokenUsage;
    const precision = tokenUsage?.precision;
    const hasUsage = (precision === 'exact' || precision === 'estimated')
      && Number.isFinite(Number(tokenUsage?.tokens));
    const scope = tokenUsage?.scope;
    const mode = scope === 'attached-context'
      || (scope !== 'session-context' && precision === 'estimated')
      ? 'attached'
      : 'session';
    const tokens = toSafeTokenCount(tokenUsage?.tokens);
    const totalTokens = toSafeTokenCount(options?.totalTokens);
    const hasTotal = totalTokens > 0;
    const rawPercent = hasTotal ? (tokens / totalTokens) * 100 : undefined;
    const displayedPercent = mode === 'session' && rawPercent !== undefined
      ? Math.min(100, rawPercent)
      : rawPercent;
    const tokenValueLabel = formatTokenCount(tokens);

    if (!hasUsage) {
      return {
        mode: 'unavailable',
        visible: true,
        hasTotal: false,
        showRemaining: false,
        showAutoCompact: false,
        ring: 'neutral',
      };
    }

    if (mode === 'attached') {
      return {
        mode,
        visible: tokens > 0,
        hasTotal,
        tokenValueLabel,
        tokenLabel: `~${tokenValueLabel}`,
        totalLabel: hasTotal ? formatTokenCount(totalTokens) : undefined,
        percentageLabel: displayedPercent === undefined ? undefined : formatPercentage(displayedPercent),
        showRemaining: false,
        showAutoCompact: false,
        ring: 'neutral',
      };
    }

    return {
      mode,
      visible: true,
      hasTotal,
      tokenValueLabel,
      tokenLabel: tokenValueLabel,
      totalLabel: hasTotal ? formatTokenCount(totalTokens) : undefined,
      percentageLabel: displayedPercent === undefined ? undefined : formatPercentage(displayedPercent),
      remainingLabel: hasTotal ? formatTokenCount(Math.max(0, totalTokens - tokens)) : undefined,
      showRemaining: hasTotal,
      showAutoCompact: hasTotal && options?.autoCompact === true,
      ring: hasTotal ? 'usage' : 'neutral',
    };
  }

  function formatScaledCount(value, scale, suffix) {
    const scaled = Math.round((value / scale) * 100) / 100;
    return `${scaled}${suffix}`;
  }

  function toSafeTokenCount(value) {
    return Math.max(0, Math.round(Number(value) || 0));
  }

  return {
    deriveContextBudgetPresentation,
    formatTokenCount,
    formatPercentage,
  };
}));
