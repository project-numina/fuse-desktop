import { Link } from 'react-router-dom';
import HeaderIcon from './HeaderIcon';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { headerControlClass } from './header-control';

export default function AppHeaderUtilities() {
  return (
    <div className="flex items-center gap-2">
      {[
        { to: '/chats', label: 'Chats', icon: 'chats' as const },
        { to: '/account', label: 'Settings', icon: 'settings' as const },
      ].map(({ to, label, icon }) => (
        <Tooltip key={to}>
          <TooltipTrigger render={<Link to={to} className={headerControlClass} aria-label={label} />}>
            <HeaderIcon name={icon} />
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
