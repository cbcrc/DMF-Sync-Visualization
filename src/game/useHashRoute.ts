import { useEffect, useState } from 'react';

export type Route = 'canvas' | 'scenarios';

const routeFromHash = (): Route => (window.location.hash.replace(/^#\/?/, '') === 'scenarios' ? 'scenarios' : 'canvas');

/** Minimal hash router: `#/scenarios` is the scenarios page, anything else is the canvas. */
export function useHashRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(routeFromHash);

  useEffect(() => {
    const onChange = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = (next: Route) => {
    window.location.hash = next === 'scenarios' ? '#/scenarios' : '#/';
  };
  return [route, navigate];
}
