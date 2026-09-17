import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../i18n'
import { ConfigSettings } from './ConfigSettings'

const api = vi.hoisted(() => ({
  getGlobalConfig: vi.fn(),
  getConfig: vi.fn(),
  getProviderConfigs: vi.fn(),
  listAvailableShells: vi.fn(),
  updateGlobalConfig: vi.fn(),
}))

vi.mock('../../../api', () => api)
vi.mock('../../../hooks', () => ({
  useCurrentDirectory: () => 'E:/workspace',
  useIsMobile: () => false,
}))

describe('ConfigSettings search', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    api.getGlobalConfig.mockResolvedValue({
      provider: {
        openai: {
          options: { baseURL: 'https://gateway.example.com' },
        },
      },
    })
    api.getConfig.mockResolvedValue({})
    api.getProviderConfigs.mockResolvedValue({})
    api.listAvailableShells.mockResolvedValue([])
    Element.prototype.scrollIntoView = vi.fn()
    Element.prototype.scrollTo = vi.fn()
  })

  it('searches a raw JSON value and opens its nested field', async () => {
    render(<ConfigSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Config Editor' }))
    await screen.findByRole('dialog', { name: 'Config Editor' })

    const input = screen.getByRole('combobox', { name: 'Search config fields...' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'gateway.example.com' } })
    const result = await screen.findByRole('option', { name: /provider\.openai\.options\.baseURL/ })
    fireEvent.click(result)

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Providers & Models' })).toHaveAttribute('aria-selected', 'true'))
    const field = await screen.findByDisplayValue('https://gateway.example.com')
    await waitFor(() => expect(field.closest('[data-config-field]')).toHaveClass('settings-search-highlight'))
    expect(field).toHaveFocus()
    // 单跑 0.5s 就过；但本文件要挂载完整 ConfigSettings + 配置编辑器弹窗（jsdom 冷启动最重的路径之一），
    // 全量并发下会超出 5s 默认值误报。给足时间，避免「新增任何测试文件就把它压崩」。
  }, 20000)
})
