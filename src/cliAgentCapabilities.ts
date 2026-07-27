import { AgentCapabilityRegistry } from './agentCapabilities';
import type { CliProfile } from './cliProfiles';

export function createCliAgentCapabilityRegistry(
  profiles: readonly CliProfile[]
): AgentCapabilityRegistry {
  return new AgentCapabilityRegistry(
    profiles.map((profile) => ({
      providerId: profile.id,
      transports: [
        {
          kind: 'cli',
          capabilities: [...profile.executionCapabilities],
        },
      ],
    }))
  );
}
