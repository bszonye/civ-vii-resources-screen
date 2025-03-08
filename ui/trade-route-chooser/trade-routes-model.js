/**
 * @file trade-route-model.ts
 * @copyright 2024, Firaxis Games
 * @description Select and get info on trade trade routes
 */

const log_level = 'happy'

 // get GameInfo on what resource does what
// console.error('mapping modifierArgs')
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

    /* matchingEntries.forEach((entry, index) => {
        console.error(`  Entry ${index}:`);
        for (const key in entry) {
            console.error(`    ${key}: ${entry[key]}`);
        }
    });
     */

    if (hasYieldType && hasResourceType && hasPercentMultiplier && hasAmount) {
        // console.error(i.ModifierId)
        const resourceType = matchingEntries.find(e => e.Name === "ResourceType").Value;
        const yieldType = matchingEntries.find(e => e.Name === "YieldType").Value;
        const amount = matchingEntries.find(e => e.Name === "Amount").Value;
        const percentMultiplier = matchingEntries.find(e => e.Name === "PercentMultiplier").Value;

        if (!resourceInfoMap.has(resourceType)) {
            resourceInfoMap.set(resourceType, new Map());
            // console.error(`Setting resourceType ${resourceType}`)
        }
        let resourceMap = resourceInfoMap.get(resourceType);
        let propertiesMap = new Map();
        propertiesMap.set('amount', amount);
        propertiesMap.set('percentMultiplier', percentMultiplier);

        resourceMap.set(yieldType, propertiesMap);
        /* console.error(`New Entry for  resourceType ${resourceType}, ${yieldType}`)
        propertiesMap.forEach((value, key) => {
          console.error(`property: ${key}`, value);
        });
         */
    }
    GameInfo.Resources.forEach(resource => {
        if (resourceInfoMap.has(resource.ResourceType)) {
            const existingEntry = resourceInfoMap.get(resource.ResourceType);
            existingEntry.ResourceClassType = resource.ResourceClassType;
        }
    });
})
/*
resourceInfoMap.forEach((entry, index) => {console.error(`  Entry ${index}:`);
        for (const key in entry) {
          console.error(`    ${key}: ${entry[key]}`);
        }
      });
 */
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
    calculateProjectedTradeRoutes() {
        const localPlayerId = GameContext.localPlayerID;
        const localPlayer = Players.get(localPlayerId);
        if (!localPlayer) {
            console.error("TradeRoutesModel - No local player, cannot calculate trade routes");
            return [];
        }
        this.projectedTradeRoutes = [];
        const possibleTradeRoutes = localPlayer.Trade?.projectPossibleTradeRoutes();
        if (!possibleTradeRoutes) {
            return [];
        }
        for (const tradeRoute of possibleTradeRoutes) {
            const targetCity = Cities.get(tradeRoute.targetCityId);
            if (!targetCity) {
                console.error("TradeRoutesModel - Unable to project trade route - City not found!");
                continue;
            }
            const player = Players.get(targetCity.owner);
            if (!player) {
                console.error("TradeRoutesModel - Unable to project trade route - Player not found!");
                continue;
            }
            const cityPlotIndex = GameplayMap.getIndexFromLocation(targetCity.location);
            const leaderIcon = GameInfo.Leaders.lookup(player.leaderType)?.LeaderType ?? "";
            const leaderName = player.leaderName;
            const isLandRoute = tradeRoute.domain == DomainType.DOMAIN_LAND;
            const statusIcon = this.getTradeRouteStatusIcon(tradeRoute.status, isLandRoute);
            const statusTexts = this.getTradeActionText(tradeRoute.status, targetCity, leaderName, isLandRoute);
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
                if (payload && payload.ResourceClassType !== "RESOURCECLASS_TREASURE") {
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
                if (payload && payload.ResourceClassType !== "RESOURCECLASS_TREASURE") {
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
                status: tradeRoute.status,
                statusIcon,
                statusText: statusTexts.statusText,
                statusTooltip: statusTexts.statusTooltip,
                statusTooltipReason: statusTexts.statusTooltipReason,
                importPayloads,
                exportYields: tradeRoute.exportYields,
                exportYieldsString,
                pathPlots: tradeRoute.pathPlots,
                resourceCount: payloadMap,
                yieldCountMap: yieldMapCount
            });
        }
        return this.projectedTradeRoutes;
    }
    getTradeRouteStatusIcon(status, isLandRoute) {
        switch (status) {
            case TradeRouteStatus.SUCCESS:
                return isLandRoute ? "TRADE_ROUTE_LAND" : "TRADE_ROUTE_SEA";
            case TradeRouteStatus.AT_WAR:
                return "TRADE_ROUTE_WAR";
            case TradeRouteStatus.DISTANCE:
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
export const TradeRoutesModel = new TradeRoutesModelImpl();

//# sourceMappingURL=file:///base-standard/ui/trade-route-chooser/trade-routes-model.js.map
