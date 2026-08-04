/**
 * @file trade-route-model.ts
 * @copyright 2024, Firaxis Games
 * @description Select and get info on trade trade routes
 */

const log_level = 'happy'
 // get GameInfo on what resource does what
let resourceInfoMap = new Map();

// RESOURCECLASS_EMPIRE
// Iterate over each game modifier
GameInfo.GameModifiers.forEach(i => {
    // Find matching entries in ModifierArguments
    const matchingEntries = GameInfo.ModifierArguments.filter(e => e.ModifierId === i.ModifierId);

    // Check if we have all required name entries
    const hasYieldType = matchingEntries.some(e => e.Name === "YieldType");
    const hasResourceType = matchingEntries.some(e => e.Name === "ResourceType");
    const hasPercentMultiplier = matchingEntries.some(e => e.Name === "PercentMultiplier");
    const hasAmount = matchingEntries.some(e => e.Name === "Amount");

    if (hasYieldType && hasResourceType && hasPercentMultiplier && hasAmount) {
        const resourceType = matchingEntries.find(e => e.Name === "ResourceType").Value;
        const yieldType = matchingEntries.find(e => e.Name === "YieldType").Value;
        const amount = matchingEntries.find(e => e.Name === "Amount").Value;
        const percentMultiplier = matchingEntries.find(e => e.Name === "PercentMultiplier").Value;

        if (!resourceInfoMap.has(resourceType)) {
            resourceInfoMap.set(resourceType, new Map());
        }
        let resourceMap = resourceInfoMap.get(resourceType);
        let propertiesMap = new Map();
        propertiesMap.set('amount', amount);
        propertiesMap.set('percentMultiplier', percentMultiplier);

        resourceMap.set(yieldType, propertiesMap);

    }
    GameInfo.Resources.forEach(resource => {
        if (resourceInfoMap.has(resource.ResourceType)) {
            const existingEntry = resourceInfoMap.get(resource.ResourceType);
            existingEntry.ResourceClassType = resource.ResourceClassType;
        }
    });
})

class TradeRoutesModelImpl {
    constructor() {
        this.projectedTradeRoutes = [];
        this.isModern = Game.age == Database.makeHash("AGE_MODERN");
        this.tradeRouteModelGroup = WorldUI.createModelGroup(`TradeRoutePath`);
        this.tradeRoutePathColor = [2, 2, 2]; // Color for the trade route arrow in linear space
    }
    getTradeRoute(tradeRouteIndex) {
        return this.projectedTradeRoutes[tradeRouteIndex];
    }
    getProjectedTradeRoutes() {
        return this.projectedTradeRoutes;
    }
    /**
   * Process a trade route.
   * @param index Which trade route to process.
   * @param possibleTradeRoutes The collection of trade routes
   * @returns true if successful, false on error
   */
    calculateRoute(tradeRoute, selectedMerchantUnit, merchantsEnRoute) {
       const targetCity = Cities.get(tradeRoute.targetCityId);
       if (!targetCity) {
          console.error(
            `TradeRoutesModel - City not found calculating route for ${ComponentID.toLogString(tradeRoute.targetCityId)}`
          );
          return false;
       }
        const player = Players.get(targetCity.owner);
        if (!player) {
          console.error(`TradeRoutesModel - Player not found calculating route for player ${targetCity.owner}`);
          return false;
        }
        const cityPlotIndex = GameplayMap.getIndexFromLocation(targetCity.location);
        let distance = -1;
        let distanceSource = "SETTLEMENT";
        if (selectedMerchantUnit) {
            const turns = this.getTurnsToTargetCity(selectedMerchantUnit, targetCity);
            if (turns >= 0) {
                distance = turns;
                distanceSource = "UNIT";
            }
        }
        if (distanceSource === "SETTLEMENT") {
            const nearestCity = Cities.get(tradeRoute.nearestCityId);
            distance = nearestCity
                ? GameplayMap.getPlotDistance(nearestCity.location.x, nearestCity.location.y, targetCity.location.x, targetCity.location.y)
                : -1;
        }
        // Does any of your trade-capable units currently have a queued move order landing inside this city's purchased plots?
        let merchantEnRouteUnitType = null;
        let merchantEnRouteUnitName = null;
        let merchantEnRouteTurns = -1;
        let merchantEnRouteUnitId = null;
        if (merchantsEnRoute && merchantsEnRoute.length > 0) {
            const targetCityPlots = targetCity.getPurchasedPlots();
            if (targetCityPlots && targetCityPlots.length > 0) {
                const plotSet = new Set(targetCityPlots);
                for (const entry of merchantsEnRoute) {
                    const destIndex = GameplayMap.getIndexFromLocation(entry.location);
                    if (plotSet.has(destIndex)) {
                        merchantEnRouteUnitType = entry.unitType;
                        merchantEnRouteUnitName = entry.unitName;
                        merchantEnRouteTurns = entry.turns;
                        merchantEnRouteUnitId = entry.unitId;
                        break;
                    }
                }
            }
        }
        const leaderIcon = GameInfo.Leaders.lookup(player.leaderType)?.LeaderType ?? "";
        const leaderName = player.leaderName;
        const isLandRoute = tradeRoute.domain === DomainType.DOMAIN_LAND;
        // EXTENDED_STATUS lets tradeRoute.status carry several simultaneous
        // reason codes like [DISTANCE, NEED_MORE_FRIENDSHIP] rather than one.
        const tradeRouteStatus = this.pickPrimaryStatus(tradeRoute.status);
        const statusIcon = this.getTradeRouteStatusIcon(tradeRouteStatus, isLandRoute);
        const statusTexts = this.getTradeActionText(tradeRouteStatus, targetCity, leaderName, isLandRoute);
        const importPayloads = [];
        const exportYieldAmounts = [];

        const payloadMap = new Map();               // per ResourceType counts
        const yieldMapCount = new Map([             // per City YieldType counts
          ['YIELD_FOOD', 0],
          ['YIELD_PRODUCTION', 0],
          ['YIELD_GOLD', 0],
          ['YIELD_SCIENCE', 0],
          ['YIELD_CULTURE', 0],
          ['YIELD_HAPPINESS', 0],
          ['YIELD_DIPLOMACY', 0]
        ]);
        const processedPayloadIds = new Set();
        for (const resource of tradeRoute.importPayloads) {
            const payload = GameInfo.Resources.lookup(resource.uniqueResource.resource);
            if (payload) {
                const payloadId = payload.ResourceType || payload.id;
                this.slthlogger('Resource payload name')
                this.slthlogger(payloadId)

                if (!payloadMap.has(payloadId)) {
                    payloadMap.set(payloadId, {
                        payload: payload,
                        count: 0,
                        firstIndex: importPayloads.length // Track first appearance
                    });
                }

                payloadMap.get(payloadId).count++;

                if (resourceInfoMap.has(payloadId)) {
                    const resourceYields = resourceInfoMap.get(payloadId)
                    resourceYields.forEach((value, key) => {
                      this.slthlogger(`yield: ${key}`, value);
                      yieldMapCount.set(key, yieldMapCount.get(key) + 1);
                    });
                }
                else {console.log(`Yield mapper had no entries for ${payloadId}`)}

                payloadMap[payloadId] += 1;
            }
        }

        // Second pass: create ordered array with sequential identical payloads
        for (const resource of tradeRoute.importPayloads) {
            const payload = GameInfo.Resources.lookup(resource.uniqueResource.resource);
            if (payload) {
                const payloadId = payload.ResourceType || payload.id;

                // Only process each unique payload type once
                if (!processedPayloadIds.has(payloadId)) {
                    processedPayloadIds.add(payloadId);
                    const count = payloadMap.get(payloadId).count;
                    for (let i = 0; i < count; i++) {
                        importPayloads.push(payload);
                    }
                }
            }
        }
        for (const yieldAmount of tradeRoute.exportYields) {
            const yieldName = GameInfo.Yields.lookup(yieldAmount.yieldType)?.YieldType ?? "";
            const yieldStyle = yieldName.toLowerCase().replace(/_/g, "-");
            exportYieldAmounts.push(Locale.compose('LOC_TRADE_LENS_YIELD', yieldStyle, yieldAmount.amount, yieldName));
        }
        const exportYieldsString = Locale.compose("LOC_TRADE_LENS_YIELD_EXPORT", exportYieldAmounts.join(", "), targetCity.name);
        this.projectedTradeRoutes.push({
            index: this.projectedTradeRoutes.length,
            city: targetCity,
            cityPlotIndex,
            leaderIcon,
            leaderName,
            status: tradeRouteStatus,
            statusIcon,
            statusText: statusTexts.statusText,
            statusTooltip: statusTexts.statusTooltip,
            statusTooltipReason: statusTexts.statusTooltipReason,
            importPayloads,
            exportYields: tradeRoute.exportYields,
            exportYieldsString,
            pathPlots: tradeRoute.pathPlots,
            resourceCount: payloadMap,
            yieldCountMap: yieldMapCount,
            distance,
            distanceSource,
            merchantEnRouteUnitType,
            merchantEnRouteUnitName,
            merchantEnRouteTurns,
            merchantEnRouteUnitId
        });
        return true;
    }
    async calculateProjectedTradeRoutes() {
        const localPlayerId = GameContext.localPlayerID;
        const localPlayer = Players.get(localPlayerId);
        if (!localPlayer) {
          console.error("TradeRoutesModel - No local player, cannot calculate trade routes");
          return [];
        }
        // EXTENDED_STATUS is required or the engine returns an empty importPayloads
        // array for routes it doesn't consider immediately actionable (e.g. NEED_MORE_FRIENDSHIP),
        // even when the target city genuinely has tradeable resources.
        const possibleTradeRoutes = localPlayer.Trade?.projectPossibleTradeRoutes(TradeRouteSearchOptions.EXTENDED_STATUS);
        if (!possibleTradeRoutes) {
          return [];
        }
        const selectedMerchantUnit = this.getSelectedMerchantUnit();
        const merchantsEnRoute = this.getMerchantsEnRoute();
        this.projectedTradeRoutes = [];
        for (const tradeRoute of possibleTradeRoutes) {
          this.calculateRoute(tradeRoute, selectedMerchantUnit, merchantsEnRoute);
        }
        return this.projectedTradeRoutes;
    }
    // Mirrors trade-route-chooser.js's getValidUnitSelection: only a selected unit
    // capable of making a trade route counts, otherwise distance falls back to the
    // nearest-settlement calculation in calculateRoute.
    getSelectedMerchantUnit() {
        const selectedUnitId = UI.Player.getHeadSelectedUnit();
        if (!selectedUnitId) {
            return null;
        }
        const unit = Units.get(selectedUnitId);
        if (!unit) {
            return null;
        }
        const unitDefinition = GameInfo.Units.lookup(unit.type);
        if (!unitDefinition?.MakeTradeRoute) {
            return null;
        }
        return unit;
    }
    // Every trade-capable unit we own, with the one plot location relevant to "is it
    // at/heading to this city" (its queued move destination if it has one, otherwise
    // its own current location — covers a unit already standing in a settlement with
    // no movement order queued) and how many turns until it gets there (0 if it's
    // already standing there). Turns are computed here, once per owned unit, rather
    // than per candidate route. Computed once per pass and checked against each
    // candidate route's target city purchased plots in calculateRoute.
    getMerchantsEnRoute() {
        const localPlayer = Players.get(GameContext.localPlayerID);
        if (!localPlayer?.Units) {
            return [];
        }
        const unitIds = localPlayer.Units.getUnitIds();
        const enRoute = [];
        for (const unitId of unitIds) {
            const unit = Units.get(unitId);
            if (!unit) {
                continue;
            }
            const unitDefinition = GameInfo.Units.lookup(unit.type);
            if (!unitDefinition?.MakeTradeRoute) {
                continue;
            }
            const destination = Units.getQueuedOperationDestination(unitId);
            let location;
            let turns;
            if (destination) {
                location = destination;
                // The queued destination is already the specific plot this unit is
                // walking to, so this paths straight to it rather than searching
                // purchased plots the way getTurnsToTargetCity does for a fresh send.
                const pathTo = Units.getPathTo(unitId, destination);
                turns = (pathTo.turns && pathTo.turns.length > 0) ? pathTo.turns[pathTo.turns.length - 1] : -1;
            } else {
                location = unit.location;
                turns = 0;
            }
            enRoute.push({ unitType: unitDefinition.UnitType, unitName: unitDefinition.Name, location, turns, unitId });
        }
        return enRoute;
    }
    // Mirrors trade-route-chooser.js's tryIssueMoveCommand: a merchant is actually sent
    // to one of the target city's purchased plots, not the city center, so that's what
    // we path/turn-count against — nearest plots first, stopping at the first reachable
    // one, same as the real send-merchant flow would try.
    getTurnsToTargetCity(unit, targetCity) {
        const targetCityPlots = targetCity.getPurchasedPlots();
        if (!targetCityPlots || targetCityPlots.length === 0) {
            return -1;
        }
        const distanceCache = new Map();
        const locationCache = new Map();
        const getLocation = (plotIndex) => {
            let location = locationCache.get(plotIndex);
            if (!location) {
                location = GameplayMap.getLocationFromIndex(plotIndex);
                locationCache.set(plotIndex, location);
            }
            return location;
        };
        const getStraightLineDistance = (plotIndex) => {
            let dist = distanceCache.get(plotIndex);
            if (dist === undefined) {
                const location = getLocation(plotIndex);
                dist = GameplayMap.getPlotDistance(unit.location.x, unit.location.y, location.x, location.y);
                distanceCache.set(plotIndex, dist);
            }
            return dist;
        };
        const sortedPlots = [...targetCityPlots].sort((a, b) => getStraightLineDistance(a) - getStraightLineDistance(b));
        for (const plotIndex of sortedPlots) {
            const location = getLocation(plotIndex);
            const pathTo = Units.getPathTo(unit.id, location);
            if (pathTo.plots && pathTo.plots.length > 0 && pathTo.turns && pathTo.turns.length > 0) {
                return pathTo.turns[pathTo.turns.length - 1];
            }
        }
        return -1;
    }
    // Most decisive/reliable reason first, DISTANCE last (see calculateRoute for why).
    STATUS_PRIORITY = [
        TradeRouteStatus.SUCCESS,
        TradeRouteStatus.AT_WAR,
        TradeRouteStatus.NEED_MORE_FRIENDSHIP,
        TradeRouteStatus.NO_URBAN_SEA_ROUTE,
        TradeRouteStatus.NO_RESOURCES,
        TradeRouteStatus.OVER_OCEAN,
        TradeRouteStatus.DISTANCE
    ];
    pickPrimaryStatus(statusArray) {
        if (!statusArray || statusArray.length === 0) {
            return TradeRouteStatus.INVALID;
        }
        for (const candidate of this.STATUS_PRIORITY) {
            if (statusArray.includes(candidate)) {
                return candidate;
            }
        }
        return statusArray[0];
    }
    getTradeRouteStatusIcon(status, isLandRoute) {
        switch (status) {
            case TradeRouteStatus.SUCCESS:
                return isLandRoute ? "TRADE_ROUTE_LAND" : "TRADE_ROUTE_SEA";
            case TradeRouteStatus.AT_WAR:
                return "TRADE_ROUTE_WAR";
            case TradeRouteStatus.DISTANCE:
                return "TRADE_ROUTE_OUT_OF_RANGE";
            case TradeRouteStatus.NO_URBAN_SEA_ROUTE:
                return "TRADE_ROUTE_OUT_OF_RANGE";
            case TradeRouteStatus.NEED_MORE_FRIENDSHIP:
                return "TRADE_ROUTE_ALLIANCE";
        }
        return "";
    }
    getTradeActionText(status, city, leaderName, isLandRoute) {
        const results = { statusText: "", statusTooltip: "", statusTooltipReason: "" };
        const localPlayerTrade = Players.get(GameContext.localPlayerID)?.Trade;
        const capacity = localPlayerTrade?.getTradeCapacityFromPlayer(city.owner) ?? 0;
        switch (status) {
            case TradeRouteStatus.SUCCESS:
                const current = localPlayerTrade?.countPlayerTradeRoutesTo(city.owner) ?? 0;
                results.statusText = this.isModern
                    ? Locale.compose("LOC_TRADE_LENS_ADD_ROUTES", current, capacity)
                    : Locale.compose("LOC_TRADE_LENS_EXISTING_ROUTES", current, capacity, leaderName);
                results.statusTooltip = isLandRoute
                    ? "LOC_TRADE_LENS_ROUTE_TYPE_LAND"
                    : "LOC_TRADE_LENS_ROUTE_TYPE_SEA";
                break;
            case TradeRouteStatus.AT_WAR:
                results.statusText = Locale.compose("LOC_TRADE_LENS_ROUTE_TYPE_WAR");
                results.statusTooltip = results.statusText;
                break;
            case TradeRouteStatus.NEED_MORE_FRIENDSHIP:
                results.statusText = Locale.compose("LOC_TRADE_LENS_ROUTE_TYPE_ALLIANCE");
                results.statusTooltip = results.statusText;
                results.statusTooltipReason = Locale.compose("LOC_TRADE_LENS_EXISTING_ROUTES_FULL", capacity, leaderName);
                break;
            case TradeRouteStatus.DISTANCE:
                results.statusText = Locale.compose("LOC_TRADE_LENS_ROUTE_TYPE_OUT_OF_RANGE");
                results.statusTooltip = results.statusText;
                break;
            case TradeRouteStatus.NO_URBAN_SEA_ROUTE:
                results.statusText = Locale.compose("LOC_TRADE_LENS_ROUTE_TYPE_NO_URBAN_SEA_ROUTE");
                results.statusTooltip = results.statusText;
                break;
        }
        return results;
    }
    // TODO: Change this to spline paths when available
    showTradeRouteVfx(plots) {
        this.tradeRouteModelGroup.clear();
        for (let i = 0; i < plots.length; ++i) {
            const plotIndex = plots[i];
            const prevIndex = i == 0 ? null : plots[i - 1];
            const nextIndex = i + 1 == plots.length ? null : plots[i + 1];
            let prevDirection = 0;
            let nextDirection = 0;
            const thisPlotCoord = GameplayMap.getLocationFromIndex(plotIndex);
            // Find the direction to the previous plot
            if (prevIndex != undefined) {
                const prevPlotCoord = GameplayMap.getLocationFromIndex(prevIndex);
                prevDirection = this.getDirectionNumberFromDirectionType(GameplayMap.getDirectionToPlot(thisPlotCoord, prevPlotCoord));
            }
            // Find the direction to the next plot
            if (nextIndex != undefined) {
                const nextPlotCoord = GameplayMap.getLocationFromIndex(nextIndex);
                nextDirection = this.getDirectionNumberFromDirectionType(GameplayMap.getDirectionToPlot(thisPlotCoord, nextPlotCoord));
            }
            this.tradeRouteModelGroup.addVFXAtPlot(this.getPathVFXforPlot(), plotIndex, { x: 0, y: 0, z: 0 }, { constants: { "start": prevDirection, "end": nextDirection, "Color3": this.tradeRoutePathColor } });
        }
    }
    clearTradeRouteVfx() {
        this.tradeRouteModelGroup.clear();
    }
    getPathVFXforPlot() {
        return "VFX_3dUI_TradeRoute_01";
    }
    getDirectionNumberFromDirectionType(direction) {
        switch (direction) {
            case DirectionTypes.DIRECTION_EAST:
                return 1;
            case DirectionTypes.DIRECTION_SOUTHEAST:
                return 2;
            case DirectionTypes.DIRECTION_SOUTHWEST:
                return 3;
            case DirectionTypes.DIRECTION_WEST:
                return 4;
            case DirectionTypes.DIRECTION_NORTHWEST:
                return 5;
            case DirectionTypes.DIRECTION_NORTHEAST:
                return 6;
        }
        return 0;
    }

    slthlogger (input) {
        if (log_level === 'blackwatch_plaid') {
            console.error(input)
        }
    }
}
function getResourceTypeIcon(resource, targetCity) {
  const localPlayerId = GameContext.localPlayerID;
  const localPlayer = Players.get(localPlayerId);
  if (!localPlayer) {
    console.error("TradeRoutesModel - No local player, cannot calculate trade routes");
    return resource.ResourceClassType;
  }
  const distantLand = localPlayer.isDistantLands(targetCity.location);
  const isTreasureResource = resource.ResourceClassType == "RESOURCECLASS_TREASURE";
  if (distantLand && isTreasureResource) {
    return "RESOURCECLASS_TREASURE_FLEET";
  }
  return resource.ResourceClassType;
}
const TradeRoutesModel = new TradeRoutesModelImpl();

export { TradeRoutesModel, getResourceTypeIcon };

//# sourceMappingURL=file:///base-standard/ui/trade-route-chooser/trade-routes-model.js.map
