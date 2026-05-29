(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  root.AgentsGuiSlashCommands = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function createBaseSlashCommands(t = defaultTranslate) {
    return [
      { name: 'new', aliases: ['clear'], kind: 'local', local: 'new', descriptionKey: 'slash.new.desc' },
      { name: 'clear', kind: 'local', local: 'new', descriptionKey: 'slash.clear.desc' },
      { name: 'help', kind: 'local', local: 'help', descriptionKey: 'slash.help.desc' },
      { name: 'context', kind: 'local', local: 'context', descriptionKey: 'slash.context.desc' },
      { name: 'refresh', kind: 'local', local: 'refresh', descriptionKey: 'slash.refresh.desc' },
      { name: 'stop', kind: 'local', local: 'stop', descriptionKey: 'slash.stop.desc' },
      { name: 'copy', kind: 'local', local: 'copy', descriptionKey: 'slash.copy.desc' },
      {
        name: 'review',
        action: 'reviewFile',
        prompt: t('quick.review.text'),
        descriptionKey: 'slash.review.desc',
      },
      {
        name: 'explain',
        action: 'explainSelection',
        prompt: t('quick.explain.text'),
        descriptionKey: 'slash.explain.desc',
      },
      {
        name: 'tests',
        aliases: ['test'],
        action: 'generateTests',
        prompt: t('quick.tests.text'),
        descriptionKey: 'slash.tests.desc',
      },
      {
        name: 'refactor',
        action: 'refactorSelection',
        prompt: t('quick.refactor.text'),
        descriptionKey: 'slash.refactor.desc',
      },
      {
        name: 'plan',
        action: 'freeform',
        prompt: t('slash.plan.prompt'),
        modeByProvider: { claude: 'plan', codex: 'plan', opencode: 'plan', gemini: 'plan', goose: 'plan' },
        descriptionKey: 'slash.plan.desc',
      },
      {
        name: 'init',
        action: 'freeform',
        prompt: t('slash.init.prompt'),
        descriptionKey: 'slash.init.desc',
      },
    ];
  }

  function parseSlashInput(value) {
    const text = String(value || '');
    if (!text.startsWith('/') || text.includes('\n')) {
      return null;
    }

    const match = /^\/([^\s]*)\s*([\s\S]*)$/.exec(text);
    if (!match) {
      return null;
    }

    const query = match[1].toLowerCase();
    return slashInputLooksLikeCommand(query)
      ? { query, args: (match[2] || '').trim() }
      : null;
  }

  function slashInputLooksLikeCommand(query) {
    if (!query) {
      return true;
    }

    return !query.includes('/') && /^[a-z0-9_-]+$/.test(query);
  }

  function slashCommandMatchesProvider(command, profile) {
    return !command.providers || command.providers.includes(profile?.id);
  }

  function slashCommandMatchesQuery(command, query) {
    if (!query) {
      return true;
    }

    const names = [command.name, ...(command.aliases || [])];
    return names.some((name) => String(name || '').toLowerCase().startsWith(query));
  }

  function profileSlashCommands(profile) {
    if (!Array.isArray(profile?.slashCommands)) {
      return [];
    }

    return profile.slashCommands
      .filter((command) => command && typeof command.name === 'string')
      .map((command) => ({
        ...command,
        kind: command.kind || 'local',
      }));
  }

  function nativeApiCommandNames(profile) {
    return new Set(
      profileSlashCommands(profile)
        .filter((command) => command.kind === 'native' && command.nativeApi)
        .map((command) => command.name)
    );
  }

  function commandsForProvider(baseCommands, profile) {
    const seen = new Set();
    const commands = [];

    for (const command of [...(baseCommands || []), ...profileSlashCommands(profile)]) {
      if (!slashCommandMatchesProvider(command, profile) || seen.has(command.name)) {
        continue;
      }

      seen.add(command.name);
      commands.push(command);
    }

    return commands;
  }

  function buildSlashCommandPrompt(command, args) {
    if (!args) {
      return command.prompt || '';
    }

    return command.prompt ? `${command.prompt}\n\n${args}` : args;
  }

  function defaultTranslate(key) {
    return key;
  }

  return {
    buildSlashCommandPrompt,
    commandsForProvider,
    createBaseSlashCommands,
    nativeApiCommandNames,
    parseSlashInput,
    profileSlashCommands,
    slashCommandMatchesProvider,
    slashCommandMatchesQuery,
    slashInputLooksLikeCommand,
  };
});
