import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/Button'
import { BellIcon } from '../../../components/Icons'
import { useNotification } from '../../../hooks'
import { notificationStore } from '../../../store'
import { Toggle, SettingRow, SettingsCard } from './SettingsUI'

export function NotificationSettings() {
  const { t } = useTranslation(['settings', 'common'])
  const {
    enabled: notificationsEnabled,
    setEnabled: setNotificationsEnabled,
    supported: notificationsSupported,
    permission: notificationPermission,
    sendNotification,
  } = useNotification()
  const [toastEnabled, setToastEnabledState] = useState(notificationStore.toastEnabled)

  const handleTestNotification = () => {
    sendNotification('OpenCode', 'This is a test notification')
  }

  const handleToastToggle = () => {
    const v = !toastEnabled
    setToastEnabledState(v)
    notificationStore.setToastEnabled(v)
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <SettingsCard
        title={t('notifications.systemNotifications')}
        description={t('notifications.systemNotificationsDesc')}
      >
        {notificationsSupported ? (
          <div className="space-y-1.5">
            <SettingRow
              label={t('notifications.notificationsLabel')}
              description={
                notificationPermission === 'denied'
                  ? t('notifications.blockedByBrowser')
                  : t('notifications.notifyWhenComplete')
              }
              icon={<BellIcon size={14} />}
              onClick={() => notificationPermission !== 'denied' && setNotificationsEnabled(!notificationsEnabled)}
            >
              <Toggle
                enabled={notificationsEnabled && notificationPermission !== 'denied'}
                onChange={() => notificationPermission !== 'denied' && setNotificationsEnabled(!notificationsEnabled)}
              />
            </SettingRow>

            <SettingRow
              label={t('notifications.testNotification')}
              description={notificationsEnabled ? t('notifications.sendSampleDesc') : t('notifications.enableToTest')}
              icon={<BellIcon size={14} />}
            >
              <Button
                size="sm"
                variant="ghost"
                onClick={handleTestNotification}
                disabled={!notificationsEnabled || notificationPermission === 'denied'}
              >
                {t('common:send')}
              </Button>
            </SettingRow>
          </div>
        ) : (
          <div className="text-[12px] text-text-400 leading-relaxed">{t('notifications.notAvailable')}</div>
        )}
      </SettingsCard>

      <SettingsCard title={t('notifications.inAppAlerts')} description={t('notifications.inAppAlertsDesc')}>
        <SettingRow
          label={t('notifications.toastNotifications')}
          description={t('notifications.toastDesc')}
          icon={<BellIcon size={14} />}
          onClick={handleToastToggle}
        >
          <Toggle enabled={toastEnabled} onChange={handleToastToggle} />
        </SettingRow>
      </SettingsCard>
    </div>
  )
}
