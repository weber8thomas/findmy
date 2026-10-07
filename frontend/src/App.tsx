import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router";
import { useConfig, useMe } from "./api/queries";
import { RealtimeProvider } from "./api/realtime";
import { PrivacyPage, PrivacyPanel } from "./features/about/Privacy";
import { AuthPage } from "./features/auth/AuthPage";
import { DeviceDetail } from "./features/devices/DeviceDetail";
import { DeviceList } from "./features/devices/DeviceList";
import { HistoryPanel } from "./features/devices/HistoryPanel";
import { ItemsPanel } from "./features/items/ItemsPanel";
import { MePanel } from "./features/me/MePanel";
import { MeDetail, MeHistory } from "./features/me/MeDetail";
import { MySourcesPanel } from "./features/me/MyLocation";
import { ProfileEdit } from "./features/me/ProfileEdit";
import { PeopleList, PersonDetail } from "./features/people/People";
import { FindMySettings } from "./features/settings/FindMySettings";
import { ICloudSettings } from "./features/settings/ICloudSettings";
import { SettingsPanel } from "./features/settings/SettingsPanel";
import { ZoneEditor, ZonesList } from "./features/zones/Zones";
import { savedLocale, useI18n } from "./i18n";
import { Shell } from "./layout/Shell";
import { useReporterLifecycle } from "./reporter/useReporter";

export function App() {
  const { data: me, isLoading } = useMe();
  const { data: config, isLoading: configLoading } = useConfig();
  const { locale, setLocale, t } = useI18n();
  useReporterLifecycle(me?.id);

  // The account language wins over the browser default once signed in.
  useEffect(() => {
    if (me && me.locale !== locale) setLocale(me.locale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.locale]);

  // Signed out: the server's language (DEFAULT_LOCALE), unless this device already has one.
  const serverLocale = config?.default_locale;
  useEffect(() => {
    if (!me && serverLocale && !savedLocale() && serverLocale !== locale) setLocale(serverLocale, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, serverLocale]);

  if (isLoading || (!me && configLoading))
    return (
      <div className="splash" role="status">
        <img src="/icons/icon.svg" alt="" width={64} height={64} />
        {t("common.loading")}
      </div>
    );

  if (!me) {
    return (
      <Routes>
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="*" element={<AuthPage mode="login" />} />
      </Routes>
    );
  }

  return (
    <RealtimeProvider userId={me.id}>
      <Routes>
        <Route element={<Shell me={me} />}>
          <Route path="/people" element={<PeopleList />} />
          <Route path="/people/me" element={<MeDetail me={me} base="/people/me" back="/people" />} />
          <Route path="/people/me/history" element={<MeHistory back="/people/me" />} />
          <Route path="/people/:id" element={<PersonDetail />} />
          <Route path="/devices" element={<DeviceList />} />
          <Route path="/devices/:id" element={<DeviceDetail />} />
          <Route path="/devices/:id/history" element={<HistoryPanel />} />
          <Route path="/items" element={<ItemsPanel />} />
          <Route path="/me" element={<MePanel me={me} />} />
          <Route path="/me/profile" element={<ProfileEdit me={me} />} />
          <Route path="/me/location" element={<MeDetail me={me} base="/me/location" back="/me" />} />
          <Route path="/me/location/history" element={<MeHistory back="/me/location" />} />
          <Route path="/me/zones" element={<ZonesList />} />
          <Route path="/me/zones/:id" element={<ZoneEditor />} />
          <Route path="/settings" element={<SettingsPanel me={me} />} />
          <Route path="/settings/location" element={<MySourcesPanel />} />
          <Route path="/settings/icloud" element={<ICloudSettings />} />
          <Route path="/settings/findmy" element={<FindMySettings />} />
          <Route path="/privacy" element={<PrivacyPanel />} />
          <Route path="*" element={<Navigate to="/devices" replace />} />
        </Route>
      </Routes>
    </RealtimeProvider>
  );
}
