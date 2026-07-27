import type { AssistantActionId } from './assistantTypes';

export type AgentTaskIntent =
  'freeform' | 'planning' | 'implementation' | 'review' | 'tests' | 'refactor' | 'explain';

export type AgentPermissionPosture = 'read-only' | 'workspace-write' | 'unrestricted';

export type AgentCapability =
  'workspace.read' | 'workspace.write' | 'terminal.execute' | 'sandbox.bypass' | 'session.resume';

export interface AgentCapabilityPolicy {
  required: AgentCapability[];
  allowed: AgentCapability[];
  denied: AgentCapability[];
}

export type AgentTransportKind = 'acp' | 'native' | 'cli';

export interface AgentTransportDescriptor {
  kind: AgentTransportKind;
  capabilities: AgentCapability[];
}

export interface AgentProviderCapabilityDescriptor {
  providerId: string;
  transports: AgentTransportDescriptor[];
}

export interface AgentCapabilityResolution {
  providerId: string;
  transport: AgentTransportKind;
  supported: AgentCapability[];
  granted: AgentCapability[];
}

export type AgentCapabilityResolutionErrorCode =
  'provider-not-registered' | 'capability-not-supported' | 'transport-not-supported';

export class AgentCapabilityResolutionError extends Error {
  constructor(
    readonly code: AgentCapabilityResolutionErrorCode,
    readonly providerId: string,
    readonly missingCapabilities: AgentCapability[] = [],
    readonly transport?: AgentTransportKind
  ) {
    super(
      code === 'provider-not-registered'
        ? `Agent provider "${providerId}" is not registered.`
        : code === 'transport-not-supported'
          ? `Agent provider "${providerId}" resolved transport "${transport}", but this execution path does not support it yet.`
          : `Agent provider "${providerId}" cannot satisfy required capabilities: ${missingCapabilities.join(', ')}.`
    );
    this.name = 'AgentCapabilityResolutionError';
  }
}

export interface ResolveAgentCapabilityPolicyOptions {
  intent: AgentTaskIntent;
  permissionPosture: AgentPermissionPosture;
  resumeSession?: boolean;
}

const TRANSPORT_PREFERENCE: AgentTransportKind[] = ['acp', 'native', 'cli'];

const ACTION_INTENTS: Record<Exclude<AssistantActionId, 'freeform'>, AgentTaskIntent> = {
  explainSelection: 'explain',
  reviewFile: 'review',
  generateTests: 'tests',
  refactorSelection: 'refactor',
};

export function resolveAgentTaskIntent(
  action: AssistantActionId,
  agentModeId?: string
): AgentTaskIntent {
  if (action !== 'freeform') {
    return ACTION_INTENTS[action];
  }

  switch (agentModeId?.trim().toLowerCase()) {
    case 'plan':
    case 'planning':
    case 'architect':
      return 'planning';
    case 'review':
      return 'review';
    case 'test':
    case 'tests':
      return 'tests';
    case 'refactor':
      return 'refactor';
    default:
      return 'freeform';
  }
}

export function resolveAgentCapabilityPolicy(
  options: ResolveAgentCapabilityPolicyOptions
): AgentCapabilityPolicy {
  const policy = baseCapabilityPolicy(options.intent, options.permissionPosture);

  if (options.resumeSession) {
    policy.required.push('session.resume');
    policy.allowed.push('session.resume');
  }

  return policy;
}

export class AgentCapabilityRegistry {
  private readonly providers = new Map<string, AgentProviderCapabilityDescriptor>();

  constructor(descriptors: AgentProviderCapabilityDescriptor[] = []) {
    for (const descriptor of descriptors) {
      this.register(descriptor);
    }
  }

  register(descriptor: AgentProviderCapabilityDescriptor): void {
    this.providers.set(descriptor.providerId, {
      providerId: descriptor.providerId,
      transports: descriptor.transports.map((transport) => ({
        kind: transport.kind,
        capabilities: [...transport.capabilities],
      })),
    });
  }

  resolve(providerId: string, policy: AgentCapabilityPolicy): AgentCapabilityResolution {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new AgentCapabilityResolutionError('provider-not-registered', providerId);
    }

    const transports = [...provider.transports].sort(
      (left, right) =>
        TRANSPORT_PREFERENCE.indexOf(left.kind) - TRANSPORT_PREFERENCE.indexOf(right.kind)
    );
    const compatible = transports.find((transport) =>
      policy.required.every((capability) => transport.capabilities.includes(capability))
    );

    if (!compatible) {
      throw new AgentCapabilityResolutionError(
        'capability-not-supported',
        providerId,
        missingCapabilitiesForBestTransport(transports, policy.required)
      );
    }

    return {
      providerId,
      transport: compatible.kind,
      supported: [...compatible.capabilities],
      granted: policy.allowed.filter(
        (capability) =>
          compatible.capabilities.includes(capability) && !policy.denied.includes(capability)
      ),
    };
  }
}

function baseCapabilityPolicy(
  intent: AgentTaskIntent,
  permissionPosture: AgentPermissionPosture
): AgentCapabilityPolicy {
  if (permissionPosture === 'read-only' || intent === 'planning' || intent === 'explain') {
    return {
      required: ['workspace.read'],
      allowed: ['workspace.read'],
      denied: ['workspace.write', 'terminal.execute', 'sandbox.bypass'],
    };
  }

  if (intent === 'review') {
    return {
      required: ['workspace.read'],
      allowed: ['workspace.read', 'terminal.execute'],
      denied: ['workspace.write', 'sandbox.bypass'],
    };
  }

  const allowed: AgentCapability[] = ['workspace.read', 'workspace.write', 'terminal.execute'];
  const required: AgentCapability[] = ['workspace.read'];
  const denied: AgentCapability[] = [];

  if (intent === 'implementation' || intent === 'tests' || intent === 'refactor') {
    required.push('workspace.write');
  }

  if (permissionPosture === 'unrestricted') {
    required.push('sandbox.bypass');
    allowed.push('sandbox.bypass');
  } else {
    denied.push('sandbox.bypass');
  }

  return { required, allowed, denied };
}

function missingCapabilitiesForBestTransport(
  transports: AgentTransportDescriptor[],
  required: AgentCapability[]
): AgentCapability[] {
  let missing = [...required];

  for (const transport of transports) {
    const candidate = required.filter((capability) => !transport.capabilities.includes(capability));
    if (candidate.length < missing.length) {
      missing = candidate;
    }
  }

  return missing;
}
