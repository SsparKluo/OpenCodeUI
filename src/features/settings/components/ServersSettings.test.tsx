import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ServersSettings } from './ServersSettings'

const { useServerStoreMock, navigateHomeMock, clearSessionMock } = vi.hoisted(() => ({
  useServerStoreMock: vi.fn(),
  navigateHomeMock: vi.fn(),
  clearSessionMock: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      typeof values?.latency === 'number' ? `${key} ${values.latency}` : key,
  }),
}))

vi.mock('../../../hooks', () => ({
  useServerStore: useServerStoreMock,
  useRouter: () => ({ navigateHome: navigateHomeMock, sessionId: 'session-1' }),
}))

vi.mock('../../../store', () => ({
  messageStore: { clearSession: clearSessionMock },
}))

const localServer = { id: 'local', name: 'Local', url: 'http://127.0.0.1:4096', isDefault: true }
const remoteServer = { id: 'remote', name: 'Remote', url: 'http://remote.test' }

describe('ServersSettings', () => {
  const checkHealthMock = vi.fn()
  const setActiveServerMock = vi.fn()
  const updateServerMock = vi.fn()

  beforeEach(() => {
    checkHealthMock.mockReset()
    setActiveServerMock.mockReset()
    updateServerMock.mockReset()
    navigateHomeMock.mockReset()
    clearSessionMock.mockReset()
    useServerStoreMock.mockReturnValue({
      servers: [localServer, remoteServer],
      activeServer: localServer,
      addServer: vi.fn(),
      removeServer: vi.fn(),
      updateServer: updateServerMock,
      setActiveServer: setActiveServerMock,
      checkHealth: checkHealthMock,
      checkAllHealth: vi.fn(),
      getHealth: vi.fn(() => null),
    })
  })

  it('switches servers even when health verification fails', async () => {
    checkHealthMock.mockResolvedValueOnce({ status: 'error', error: 'Not an OpenCode server' })

    render(<ServersSettings />)

    fireEvent.click(screen.getByRole('button', { name: /Remote/ }))

    await waitFor(() => {
      expect(checkHealthMock).toHaveBeenCalledWith('remote')
    })
    expect(setActiveServerMock).toHaveBeenCalledWith('remote')
    expect(navigateHomeMock).toHaveBeenCalled()
    expect(clearSessionMock).toHaveBeenCalledWith('session-1')
  })

  it('exposes an edit button on the default server but no remove button', () => {
    render(<ServersSettings />)

    const localRow = screen.getByRole('button', { name: /Local/ }).parentElement
    expect(localRow).not.toBeNull()
    const localScope = within(localRow!)

    expect(localScope.getByRole('button', { name: 'servers.editServer' })).toBeInTheDocument()
    expect(localScope.queryByRole('button', { name: 'common:remove' })).not.toBeInTheDocument()
  })

  it('keeps the remove button on non-default servers', () => {
    render(<ServersSettings />)

    const remoteRow = screen.getByRole('button', { name: /Remote/ }).parentElement
    expect(remoteRow).not.toBeNull()
    const remoteScope = within(remoteRow!)

    expect(remoteScope.getByRole('button', { name: 'servers.editServer' })).toBeInTheDocument()
    expect(remoteScope.getByRole('button', { name: 'common:remove' })).toBeInTheDocument()
  })

  it('hides the name and URL fields when editing the default server and only persists auth', () => {
    render(<ServersSettings />)

    const localRow = screen.getByRole('button', { name: /Local/ }).parentElement
    expect(localRow).not.toBeNull()
    fireEvent.click(within(localRow!).getByRole('button', { name: 'servers.editServer' }))

    expect(screen.queryByPlaceholderText('servers.namePlaceholder')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('servers.urlPlaceholder')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('servers.usernamePlaceholder')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('servers.passwordPlaceholder')).toBeInTheDocument()
    expect(screen.getByText('servers.defaultServerAuthHint')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('servers.usernamePlaceholder'), {
      target: { value: 'admin' },
    })
    fireEvent.change(screen.getByPlaceholderText('servers.passwordPlaceholder'), {
      target: { value: 's3cret' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'common:save' }))

    expect(updateServerMock).toHaveBeenCalledWith('local', {
      name: 'Local',
      url: 'http://127.0.0.1:4096',
      auth: { username: 'admin', password: 's3cret' },
    })
    expect(checkHealthMock).toHaveBeenCalledWith('local')
  })

  it('allows clearing auth on the default server by saving an empty password', () => {
    useServerStoreMock.mockReturnValueOnce({
      servers: [{ ...localServer, auth: { username: 'admin', password: 's3cret' } }, remoteServer],
      activeServer: localServer,
      addServer: vi.fn(),
      removeServer: vi.fn(),
      updateServer: updateServerMock,
      setActiveServer: setActiveServerMock,
      checkHealth: checkHealthMock,
      checkAllHealth: vi.fn(),
      getHealth: vi.fn(() => null),
    })

    render(<ServersSettings />)

    const localRow = screen.getByRole('button', { name: /Local/ }).parentElement
    expect(localRow).not.toBeNull()
    fireEvent.click(within(localRow!).getByRole('button', { name: 'servers.editServer' }))

    fireEvent.change(screen.getByPlaceholderText('servers.passwordPlaceholder'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'common:save' }))

    expect(updateServerMock).toHaveBeenCalledWith('local', {
      name: 'Local',
      url: 'http://127.0.0.1:4096',
      auth: undefined,
    })
  })
})
