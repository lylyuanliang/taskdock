export const mobilePrimaryRoutes = ["today", "inbox", "projects", "settings"] as const;

export type MobilePrimaryRoute = (typeof mobilePrimaryRoutes)[number];

export type MobileRoute = MobilePrimaryRoute | "taskEditor" | "syncSettings" | "conflicts";

function isPrimaryRoute(route: MobileRoute): route is MobilePrimaryRoute {
  return mobilePrimaryRoutes.includes(route as MobilePrimaryRoute);
}

export function getMobileBackRoute(
  route: MobileRoute,
  previousRoute: MobileRoute = "today",
): MobilePrimaryRoute | "syncSettings" {
  if (route === "taskEditor") {
    return isPrimaryRoute(previousRoute) ? previousRoute : "today";
  }

  if (route === "syncSettings") {
    return "settings";
  }

  if (route === "conflicts") {
    return "syncSettings";
  }

  return isPrimaryRoute(previousRoute) ? previousRoute : "today";
}

export function transitionMobileRoute(
  currentRoute: MobileRoute,
  requestedRoute: MobileRoute,
  previousRoute?: MobileRoute,
): MobileRoute {
  if (currentRoute === requestedRoute) {
    return currentRoute;
  }

  if (currentRoute === "taskEditor") {
    return requestedRoute === getMobileBackRoute(currentRoute, previousRoute)
      ? requestedRoute
      : currentRoute;
  }

  if (currentRoute === "syncSettings") {
    return isPrimaryRoute(requestedRoute) || requestedRoute === "conflicts"
      ? requestedRoute
      : currentRoute;
  }

  if (currentRoute === "conflicts") {
    return isPrimaryRoute(requestedRoute) || requestedRoute === "syncSettings"
      ? requestedRoute
      : currentRoute;
  }

  if (isPrimaryRoute(requestedRoute) || requestedRoute === "taskEditor") {
    return requestedRoute;
  }

  if (requestedRoute === "syncSettings" && currentRoute === "settings") {
    return requestedRoute;
  }

  return currentRoute;
}
