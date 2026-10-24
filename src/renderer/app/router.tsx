import { Route, Routes } from 'react-router';
import { AppShell } from '../components/layout/app-shell';
import { DashboardPage } from '../features/dashboard/dashboard-page';
import { FoldersPage } from '../features/folders/folders-page';
import { FilesPage } from '../features/files/files-page';
import { OrganizePage } from '../features/organize/organize-page';
import { DuplicatesPage } from '../features/duplicates/duplicates-page';
import { HistoryPage } from '../features/history/history-page';
import { SettingsPage } from '../features/settings/settings-page';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="folders" element={<FoldersPage />} />
        <Route path="files" element={<FilesPage />} />
        <Route path="organize" element={<OrganizePage />} />
        <Route path="duplicates" element={<DuplicatesPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<DashboardPage />} />
      </Route>
    </Routes>
  );
}
