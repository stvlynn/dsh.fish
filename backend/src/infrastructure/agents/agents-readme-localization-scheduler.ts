import { getAgentByName } from 'agents'
import type {
  ReadmeLocalizationScheduler,
  ScheduleReadmeLocalizationInput,
} from '../../application/port/readme-localization.js'
import type { HubEnv } from '../config/env.js'
import type { ReadmeI18nAgent } from './readme-i18n-agent.js'
import { readmeI18nShardName } from './readme-i18n-shards.js'

export class AgentsReadmeLocalizationScheduler implements ReadmeLocalizationScheduler {
  constructor(
    private readonly namespace: DurableObjectNamespace<ReadmeI18nAgent>,
    private readonly locales: readonly string[],
  ) {}

  async schedule(input: ScheduleReadmeLocalizationInput): Promise<void> {
    const agent = await getAgentByName<HubEnv, ReadmeI18nAgent>(
      this.namespace,
      readmeI18nShardName(String(input.artifactId)),
    )
    await agent.enqueueReadme({ ...input, locales: this.locales })
  }
}
