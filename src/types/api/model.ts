import type {
  Model as SDKModel,
  Provider as SDKProvider,
  ProviderAuthAuthorization as SDKProviderAuthAuthorization,
  ProviderAuthMethod as SDKProviderAuthMethod,
} from '@opencode-ai/sdk/v2/client'

export type ModelIOCapabilities = SDKModel['capabilities']['input']

export type ModelCapabilities = SDKModel['capabilities']

export type ModelLimit = SDKModel['limit']

export type ModelStatus = SDKModel['status']

export type Model = SDKModel

export type Provider = SDKProvider

export interface ProvidersResponse {
  providers: Provider[]
  default: Record<string, string>
}

export type ProviderAuthMethod = SDKProviderAuthMethod

export type ProviderAuthAuthorization = SDKProviderAuthAuthorization
