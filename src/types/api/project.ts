import type { Path as SDKPath, Project as SDKProject } from '@opencode-ai/sdk/v2/client'

export type Project = SDKProject

export type ProjectIcon = NonNullable<Project['icon']>

export type ProjectCommands = NonNullable<Project['commands']>

export interface ProjectUpdateParams {
  name?: string
  icon?: ProjectIcon
  commands?: ProjectCommands
}

export type PathResponse = SDKPath
