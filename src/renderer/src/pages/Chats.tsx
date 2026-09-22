import AppFooter from '@/components/layout/AppFooter';
import AppHeader from '@/components/layout/AppHeader';
import ChatsView from '@/pages/chats/ChatsView';
import { useChatsPage } from '@/pages/chats/use-chats-page';

/** Paginated history of conversations across all repositories and blueprints. */
export default function Chats() {
  const model = useChatsPage();
  return (
    <div className="page-bg flex h-screen flex-col overflow-y-auto">
      <AppHeader />
      <ChatsView model={model} />
      <AppFooter />
    </div>
  );
}
