import { useTheme } from '../../theme';

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="fc-toolbar__btn nodrag"
      onClick={toggle}
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
    >
      {theme === 'dark' ? '☀ Light Mode' : '☾ Dark Mode'}
    </button>
  );
}
