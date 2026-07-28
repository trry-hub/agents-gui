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
      const rounded = Math.round(value * 10) / 10;
      return rounded >= 1 ? '<1' : String(rounded);
    }
    const rounded = Math.round(value);
    return value < 100 && rounded >= 100 ? '<100' : String(rounded);
  }

  function deriveContextBudgetPresentation(options) {
    const tokenUsage = options?.tokenUsage;
    const precision = tokenUsage?.precision;
    const hasUsage = (precision === 'exact' || precision === 'estimated')
      && typeof tokenUsage?.tokens === 'number'
      && Number.isFinite(tokenUsage.tokens)
      && tokenUsage.tokens >= 0;
    const tokens = toSafeTokenCount(tokenUsage?.tokens);

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

    const scope = tokenUsage?.scope;
    if (precision === 'estimated' && scope === 'session-context') {
      return {
        mode: 'unavailable',
        visible: true,
        hasTotal: false,
        showRemaining: false,
        showAutoCompact: false,
        ring: 'neutral',
      };
    }

    const mode = scope === 'attached-context'
      || (scope !== 'session-context' && precision === 'estimated')
      ? 'attached'
      : 'session';
    const hasTotal = typeof options?.totalTokens === 'number'
      && Number.isFinite(options.totalTokens)
      && options.totalTokens > 0;
    const totalTokens = hasTotal ? Math.round(options.totalTokens) : 0;
    const rawPercent = hasTotal ? (tokens / totalTokens) * 100 : undefined;
    const displayedPercent = mode === 'session' && rawPercent !== undefined
      ? Math.min(100, rawPercent)
      : rawPercent;
    const tokenValueLabel = formatTokenCount(tokens);

    if (mode === 'attached') {
      return {
        mode,
        precision,
        visible: tokens > 0,
        hasTotal,
        tokenValueLabel,
        tokenLabel: precision === 'estimated' ? `~${tokenValueLabel}` : tokenValueLabel,
        totalLabel: hasTotal ? formatTokenCount(totalTokens) : undefined,
        percentageLabel: displayedPercent === undefined ? undefined : formatPercentage(displayedPercent),
        showRemaining: false,
        showAutoCompact: false,
        ring: 'neutral',
      };
    }

    return {
      mode,
      precision,
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
    if (suffix === 'k' && scaled >= 1000) {
      return formatScaledCount(value, 1000000, 'm');
    }
    return `${scaled}${suffix}`;
  }

  function toSafeTokenCount(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return 0;
    }
    return Math.max(0, Math.round(numericValue));
  }

  return {
    deriveContextBudgetPresentation,
    formatTokenCount,
    formatPercentage,
  };
}));
