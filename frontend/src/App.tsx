import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router";
import { useConfig, useMe } from "./api/queries";
import { RealtimeProvider } from "./api/realtime";
import { AuthPage } from "./features/auth/AuthPage";
import { DeviceDetail } from "./features/devices/DeviceDetail";
import { DeviceList } from "./features/devices/DeviceList";
import { HistoryPanel } from "./features/devices/HistoryPanel";
import { ItemsPanel } from "./features/items/ItemsPanel";
import { MePanel } from "./features/me/MePanel";
import { PeopleList, PersonDetail } from "./features/people/People";
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
        <Route path="*" element={<AuthPage mode="login" />} />
      </Routes>
    );
  }

  return (
    <RealtimeProvider userId={me.id}>
      <Routes>
        <Route element={<Shell me={me} />}>
          <Route path="/people" element={<PeopleList />} />
          <Route path="/people/:id" element={<PersonDetail />} />
          <Route path="/devices" element={<DeviceList />} />
          <Route path="/devices/:id" element={<DeviceDetail />} />
          <Route path="/devices/:id/history" element={<HistoryPanel />} />
          <Route path="/items" element={<ItemsPanel />} />
          <Route path="/me" element={<MePanel me={me} />} />
          <Route path="/me/zones" element={<ZonesList />} />
          <Route path="/me/zones/:id" element={<ZoneEditor />} />
          <Route path="*" element={<Navigate to="/devices" replace />} />
        </Route>
      </Routes>
    </RealtimeProvider>
  );
}
