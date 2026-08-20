import { Audio } from '/core/ui/audio-base/audio-support.js'
import ActionHandler from '/core/ui/input/action-handler.js';
import { ActiveDeviceTypeChangedEventName } from '/core/ui/input/input-events.js'

import {Focus} from '/core/ui/input/focus-support.js';
import {InterfaceMode} from '../../../core/ui/interface-modes/interface-modes.js';
import LensManager from '/core/ui/lenses/lens-manager.js';
import NavTray from '/core/ui/navigation-tray/model-navigation-tray.js';
import Panel from '/core/ui/panel-support.js';
import { HideMiniMapEvent } from '../mini-map/panel-mini-map.js';
import {TradeRoutesModel, getResourceTypeIcon} from '/base-standard/ui/trade-route-chooser/trade-routes-model.js';
import { UnitFlagManager } from '../unit-flags/unit-flag-manager.js';
import WorldInput from '../world-input/world-input.js';
import styles from './trade-route-chooser.scss.js';


const resourceTableMap = new Map()
GameInfo.Resources.forEach(i => {
    resourceTableMap.set(i.ResourceType, i)
})

const RELATIONSHIP_TYPE_STRINGS = {
    [DiplomacyPlayerRelationships.PLAYER_RELATIONSHIP_HOSTILE]: "PLAYER_RELATIONSHIP_HOSTILE",
    [DiplomacyPlayerRelationships.PLAYER_RELATIONSHIP_UNFRIENDLY]: "PLAYER_RELATIONSHIP_UNFRIENDLY",
    [DiplomacyPlayerRelationships.PLAYER_RELATIONSHIP_NEUTRAL]: "PLAYER_RELATIONSHIP_NEUTRAL",
    [DiplomacyPlayerRelationships.PLAYER_RELATIONSHIP_FRIENDLY]: "PLAYER_RELATIONSHIP_FRIENDLY",
    [DiplomacyPlayerRelationships.PLAYER_RELATIONSHIP_HELPFUL]: "PLAYER_RELATIONSHIP_HELPFUL"
};
// Worst to best, matching the order relationship tiers actually escalate in-game.
const RELATIONSHIP_ORDER = [
    "PLAYER_RELATIONSHIP_AT_WAR",
    "PLAYER_RELATIONSHIP_HOSTILE",
    "PLAYER_RELATIONSHIP_UNFRIENDLY",
    "PLAYER_RELATIONSHIP_NEUTRAL",
    "PLAYER_RELATIONSHIP_FRIENDLY",
    "PLAYER_RELATIONSHIP_HELPFUL",
    "PLAYER_RELATIONSHIP_ALLIANCE"
];

// Icon/context pairs verified live via UI.getIconCSS against the running game.
const SORT_MODES = [
    {mode: "LOC_TRADE_LENS_SORT_DEFAULT", icon: "TRADE_ROUTE_LAND", context: "TRADE"},
    {mode: "LOC_TRADE_LENS_SORT_BY_LEADER", icon: "LEADER_MINOR_CIV_DEFAULT", context: "LEADER"},
    {mode: "LOC_TRADE_LENS_SORT_BY_RESOURCE", icon: "RADIAL_RESOURCES", context: "DEFAULT"},
    {mode: "LOC_TRADE_LENS_SORT_BY_YIELD", icon: "CITY_YIELDS_HI", context: "DEFAULT"},
    {mode: "LOC_TRADE_LENS_SORT_BY_DISTANCE", icon: "YIELD_TRADES", context: "YIELD"}
];

class TradeRouteChooser extends Panel {
    static _activeChooser;
    static MINOR_CIV_LEADER = 'LEADER_MINOR_CIV_DEFAULT';
    tradeRoutes;
    isModern = Game.age == Database.makeHash("AGE_MODERN");
    isExploration = Game.age == Database.makeHash("AGE_EXPLORATION");
    frame = document.createElement("fxs-subsystem-frame");
    routesListEl = document.createElement("fxs-vslot");
    gamePadFooter = document.createElement("div");
    selectedUnitID = UI.Player.getHeadSelectedUnit();
    selectedEl;
    selectedRoute;
    tradeRouteBanner;
    confirmButton = document.createElement("fxs-hero-button");
    sortMode = "LOC_TRADE_LENS_SORT_DEFAULT";
    navigateInputListener = this.onNavigateInput.bind(this);
    activeDeviceTypeListener = this.updateInputDeviceType.bind(this);
    engineInputListener = this.onEngineInput.bind(this);
    interfaceModeListener = this.onInterfaceModeChange.bind(this);
    subsystemFrameCloseListener = () => this.close();

    static get activeChooser() {
        return this._activeChooser;
    }

    constructor(root) {
        super(root);
        this.failsAtBottom = true
        this.failsAtBottomTracker = this.onTrackFailsActivate.bind(this);
        this.resourceTracker = this.onSwitchResourceActivate.bind(this);
        this.yieldTracker = this.onSwitchYieldActivate.bind(this);
        this.classTracker = this.onSwitchClassActivate.bind(this);
        this.leaderTracker = this.onSwitchLeaderActivate.bind(this);
        this.sortModeTracker = this.onSwitchSortModeActivate.bind(this);

        this.frame = document.createElement("fxs-subsystem-frame");
        this.routesListEl = document.createElement("fxs-vslot");
        this.selectedUnitID = UI.Player.getHeadSelectedUnit();
        this.confirmButton = document.createElement("fxs-hero-button");
        this.sortMode = "LOC_TRADE_LENS_SORT_DEFAULT";
        this.navigateInputListener = this.onNavigateInput.bind(this);
        this.activeDeviceTypeListener = this.updateInputDeviceType.bind(this);
        this.engineInputListener = this.onEngineInput.bind(this);
        this.subsystemFrameCloseListener = () => this.close();
        this.tradeRoutes = TradeRoutesModel.getProjectedTradeRoutes().map((route) => ({
            route,
            element: this.createTradeRouteChooserItem(route)
        }));
        const fragment = document.createDocumentFragment();
        fragment.appendChild(this.frame);
        const titleContainer = document.createElement("div");
        titleContainer.classList.add("header-container");
        titleContainer.style.display = "flex";
        titleContainer.style.flexDirection = "row";
        titleContainer.setAttribute("data-slot", "header");
        this.frame.appendChild(titleContainer);
        const title = document.createElement("fxs-header");
        title.setAttribute("data-slot", "header");
        title.setAttribute("title", this.isModern ? "LOC_TRADE_LENS_TITLE_ALT" : "LOC_TRADE_LENS_TITLE");
        title.classList.add("px-12");
        title.style.marginLeft = "1rem";
        titleContainer.appendChild(title)

        const headerContainer = document.createElement("div");
        headerContainer.classList.add("header-container", "flex", "items-center", "mx-3\\.5", "mb-2");
        headerContainer.setAttribute("data-slot", "header");
        this.frame.appendChild(headerContainer);

        this.checkBoxText = document.createElement('p');
        this.checkBoxText.classList.add('font-title-sm', 'leading-loose', 'text-gradient-secondary');
        this.checkBoxText.classList.add("text-center", "font-body-sm");
        this.checkBoxText.innerHTML = Locale.compose('LOC_SLTH_TRADE_TICKBOX');

        this.checkBox = document.createElement('fxs-checkbox');
        this.checkBox.setAttribute('selected', `${this.failsAtBottom}`);
        this.checkBox.setAttribute("tabindex", "-1");
        this.checkBox.classList.add('advisor-victory_tracker', 'size-7', 'mx-1');

        this.setupSortModeSelector(headerContainer)
        headerContainer.appendChild(this.checkBox);
        headerContainer.appendChild(this.checkBoxText);

        this.setupResourceSelector(this.frame)
        this.setupYieldSelector(this.frame)
        this.setupClassSelector(this.frame)
        this.setupLeaderSelector(this.frame)
        this.setupRelationshipSelector(this.frame)
        this.updateSelectorVisibilityForSortMode()

        this.routesListEl.setAttribute("disable-focus-allowed", "true");
        this.routesListEl.classList.add("ml-3");
        this.frame.appendChild(this.routesListEl);
        this.confirmButton.classList.add("mx-7", "my-5");
        this.confirmButton.setAttribute("data-slot", "footer");
        this.confirmButton.setAttribute("disabled", "true");
        this.updateConfirmButton();
        this.confirmButton.addEventListener("action-activate", () => this.checkAndStartTradeRoute());
        this.gamePadFooter.setAttribute("data-slot", "footer");
        this.gamePadFooter.classList.add("size-6", "game-pad-footer");
        this.frame.appendChild(this.confirmButton);
        this.frame.appendChild(this.gamePadFooter);
        this.updateInputDeviceType();
        this.Root.appendChild(fragment);
    }
    updateConfirmButton() {
        const isTradeRouteValid = this.selectedRoute?.status == TradeRouteStatus.SUCCESS;
        const unit = this.getValidUnitSelection(this.selectedUnitID);
        const targetLocation = this.selectedRoute?.city.location;
        let canStartTradeRoute = false;
        if (unit && targetLocation) {
            this.initializeNavTrayCancelAction();
            const actionParams = { X: targetLocation.x, Y: targetLocation.y };
            canStartTradeRoute = Game.UnitCommands.canStart(
                unit.id,
                UnitCommandTypes.MAKE_TRADE_ROUTE,
                actionParams,
                false
            ).Success;
        }
        // Show "Confirm" text if we are in modern age or the selected merchant is in range to begin the trade route
        const caption = this.isModern || canStartTradeRoute ? "LOC_TRADE_LENS_CONFIRM_ROUTE" : "LOC_TRADE_LENS_SEND_MERCHANT";
        this.confirmButton.setAttribute("caption", caption);
        const disabled = !unit || !isTradeRouteValid;
        this.confirmButton.setAttribute("disabled", disabled.toString());
        if (unit) {
            if (!this.selectedRoute) {
                this.confirmButton.setAttribute("data-tooltip-content", "LOC_TRADE_LENS_NO_TRADE_ROUTE_SELECTED");
            } else {
                this.confirmButton.setAttribute(
                    "data-tooltip-content",
                    this.isModern || canStartTradeRoute ? "LOC_TRADE_LENS_CONFIRM_ROUTE_TOOLTIP" : "LOC_TRADE_LENS_SEND_MERCHANT_TOOLTIP"
                );
            }
        } else {
            this.confirmButton.setAttribute("data-tooltip-content", "LOC_TRADE_LENS_NO_MERCHANT_SELECTED_TOOLTIP");
        }
    }
    onInitialize() {
        this.applySort();
    }
    onAttach() {
        super.onAttach();
        engine.on("UnitSelectionChanged", this.onUnitSelectionChanged, this);
        this.Root.addEventListener("navigate-input", this.navigateInputListener);
        window.addEventListener("interface-mode-changed", this.interfaceModeListener);
        this.Root.addEventListener("engine-input", this.engineInputListener);
        this.frame.addEventListener("subsystem-frame-close", this.subsystemFrameCloseListener);
        window.addEventListener(ActiveDeviceTypeChangedEventName, this.activeDeviceTypeListener, true);
        this.checkBox.addEventListener("action-activate", this.failsAtBottomTracker);
        window.dispatchEvent(new HideMiniMapEvent(true));
        TradeRouteChooser._activeChooser = this;
        Focus.setContextAwareFocus(this.routesListEl, this.Root);
    }
    onDetach() {
        super.onDetach();
        TradeRouteChooser._activeChooser = void 0;
        TradeRoutesModel.clearTradeRouteVfx();
        this.tradeRouteBanner?.remove();
        engine.off("UnitSelectionChanged", this.onUnitSelectionChanged, this);
        this.Root.removeEventListener("navigate-input", this.navigateInputListener);
        this.Root.removeEventListener("engine-input", this.engineInputListener);
        this.frame.removeEventListener("subsystem-frame-close", this.subsystemFrameCloseListener);
        window.removeEventListener(ActiveDeviceTypeChangedEventName, this.activeDeviceTypeListener, true);
        window.removeEventListener("interface-mode-changed", this.interfaceModeListener);
        this.checkBox.removeEventListener("action-activate", this.failsAtBottomTracker);
        window.dispatchEvent(new HideMiniMapEvent(false));
    }
    onUnitSelectionChanged({ selected, unit }) {
        this.handleUnitSelectionChanged(selected ? unit : null);
    }
    handleUnitSelectionChanged(unitID) {
        if (this.getValidUnitSelection(unitID)) {
            this.initializeNavTrayCancelAction();
            this.selectedUnitID = unitID;
        }
        this.updateConfirmButton();
    }
    getValidUnitSelection(unitID) {
        if (!unitID) {
            return null;
        }
        const unit = Units.get(unitID);
        if (!unit) {
            return null;
        }
        const unitDefinition = GameInfo.Units.lookup(unit.type);
        if (!unitDefinition?.MakeTradeRoute) {
            return null;
        }
        return unit;
    }
    initializeNavTrayCancelAction() {
        NavTray.clear();
        const selctedUnit = UI.Player.getHeadSelectedUnit();
        if (selctedUnit && this.isModern) {
            NavTray.addOrUpdateGenericCancel();
        } else {
            NavTray.addOrUpdateGenericBack();
        }
    }
    onReceiveFocus() {
        super.onReceiveFocus();
        Focus.setContextAwareFocus(this.routesListEl, this.Root);
        NavTray.clear();
        if (this.isModern) {
            NavTray.addOrUpdateGenericAccept();
        }
        NavTray.addOrUpdateGenericCancel();
        if (this.isModern) {
            NavTray.addOrUpdateGenericSelect();
        }
        waitForLayout(() => {
            waitForLayout(() => {
                Focus.setContextAwareFocus(this.routesListEl, this.Root);
            });
        });
    }
    onLoseFocus() {
        super.onLoseFocus();
        NavTray.clear();
    }
    close(uiViewChangeMethod) {
        super.close(uiViewChangeMethod);
        if (LensManager.getActiveLens() != "fxs-default-lens") {
            LensManager.setActiveLens("fxs-default-lens");
        }
    }
    // close panel if unit move action is selected
    onInterfaceModeChange(event) {
        if (event.detail.newMode === "INTERFACEMODE_MOVE_TO") {
            this.close();
        }
    }
    onEngineInput(inputEvent) {
        if (inputEvent.detail.status != InputActionStatuses.FINISH) {
            return;
        }
        if (inputEvent.detail.name == "cancel" || inputEvent.detail.name == "sys-menu") {
            NavTray.clear();
            this.close();
            inputEvent.stopPropagation();
            inputEvent.preventDefault();
            return;
        }
        if (inputEvent.detail.name == "mousebutton-right") {
            NavTray.clear();
            this.close();
        }
    }
    onNavigateInput(event) {
        if (event.detail.status != InputActionStatuses.FINISH) {
            return;
        }
        const direction = event.getDirection();
        if (direction == InputNavigationAction.SHELL_PREVIOUS) {
            this.cycleSortMode(-1);
            Focus.setContextAwareFocus(this.routesListEl, this.Root);
            Audio.playSound("data-audio-activate", "audio-pager");
            event.stopPropagation();
        } else if (direction == InputNavigationAction.SHELL_NEXT) {
            this.cycleSortMode(1);
            Focus.setContextAwareFocus(this.routesListEl, this.Root);
            Audio.playSound("data-audio-activate", "audio-pager");
            event.stopPropagation();
        }
    }
    updateInputDeviceType() {
        if (this.confirmButton) {
            this.confirmButton.classList.toggle("hidden", ActionHandler.isGamepadActive);
            this.gamePadFooter.classList.toggle("hidden", !ActionHandler.isGamepadActive);
        }
    }
    defaultSort(a, b) {
        if (this.failsAtBottom) {
            const statusComparison = Number(b.route.status == TradeRouteStatus.SUCCESS) - Number(a.route.status == TradeRouteStatus.SUCCESS);
            if (statusComparison !== 0) {
                return statusComparison;
            }
        }
        return (b.route.importPayloads.length) - (a.route.importPayloads.length);
    }

    leaderSort(a, b) {
        if (this.failsAtBottom) {
            const statusComparison = Number(b.route.status == TradeRouteStatus.SUCCESS) -
                Number(a.route.status == TradeRouteStatus.SUCCESS);
            if (statusComparison !== 0) {
                return statusComparison;
            }
        }
        const aMatch = this.matchesLeaderSortBy(a.route) ? 1 : 0;
        const bMatch = this.matchesLeaderSortBy(b.route) ? 1 : 0;
        const leaderComparison = bMatch - aMatch;
        if (leaderComparison !== 0) {
            return leaderComparison;
        }
        // relationship mode, we also secondary sort by relationship amount. Reversed when in Hostile mode.
        if (this.isRelationshipSortBy()) {
            const aAmount = this.getRelationshipAmount(a.route.city.owner);
            const bAmount = this.getRelationshipAmount(b.route.city.owner);
            const ascending = this.leaderSortBy === 'PLAYER_RELATIONSHIP_HOSTILE';
            const amountComparison = ascending ? (aAmount - bAmount) : (bAmount - aAmount);
            if (amountComparison !== 0) {
                return amountComparison;
            }
        }
        return (b.route.importPayloads.length) - (a.route.importPayloads.length);
    }

    isRelationshipSortBy() {
        return typeof this.leaderSortBy === "string" && this.leaderSortBy.startsWith("PLAYER_RELATIONSHIP_");
    }

    getRelationshipAmount(owner) {
        const dip = Players.get(owner)?.Diplomacy;
        return dip ? dip.getRelationshipLevel(GameContext.localPlayerID) : 0;
    }

    matchesLeaderSortBy(route) {
        if (this.leaderSortBy === TradeRouteChooser.MINOR_CIV_LEADER) {
            return Players.get(route.city.owner)?.isMinor === true;
        }
        if (typeof this.leaderSortBy === "string" && this.leaderSortBy.startsWith("PLAYER_RELATIONSHIP_")) {
            return this.getRelationshipKey(route.city.owner) === this.leaderSortBy;
        }
        return route.city.owner === this.leaderSortBy;
    }

    resourceSort(a, b) {
        if (this.failsAtBottom) {
            const statusComparison = Number(b.route.status == TradeRouteStatus.SUCCESS) -
                Number(a.route.status == TradeRouteStatus.SUCCESS);
            if (statusComparison !== 0) {
                return statusComparison;
            }
        }
        const aResourceCount = a.route.resourceCount.get(this.resourceSortBy)?.count || 0;
        const bResourceCount = b.route.resourceCount.get(this.resourceSortBy)?.count || 0;

        const resourceComparison = bResourceCount - aResourceCount;

        if (resourceComparison === 0) {
            return (b.route.importPayloads.length) - (a.route.importPayloads.length);
        }

        return resourceComparison;
    }

    modernResourceSort(a, b) {
        if (this.failsAtBottom) {
            const statusComparison = Number(b.route.status == TradeRouteStatus.SUCCESS) -
                Number(a.route.status == TradeRouteStatus.SUCCESS);
            if (statusComparison !== 0) {
                return statusComparison;
            }
        }
        const distantLandsKey = this.resourceSortBy + "_DISTANT_LANDS";

        let aResourceCount = a.route.resourceCount.get(this.resourceSortBy)?.count || 0;
        let bResourceCount = b.route.resourceCount.get(this.resourceSortBy)?.count || 0;

        if (a.route.resourceCount.has(distantLandsKey) || b.route.resourceCount.has(distantLandsKey)) {
            aResourceCount = aResourceCount + a.route.resourceCount.get(distantLandsKey)?.count || 0;
            bResourceCount = aResourceCount + b.route.resourceCount.get(distantLandsKey)?.count || 0;
        }

        const resourceComparison = bResourceCount - aResourceCount;

        if (resourceComparison === 0) {
            return (b.route.importPayloads.length) - (a.route.importPayloads.length);
        }

        return resourceComparison;
    }

    yieldSort(a, b) {
        if (this.failsAtBottom) {
            const statusComparison = Number(b.route.status == TradeRouteStatus.SUCCESS) -
                Number(a.route.status == TradeRouteStatus.SUCCESS);
            if (statusComparison !== 0) {
                return statusComparison;
            }
        }
        let aYieldCount = a.route.yieldCountMap.get(this.yieldSortBy) || 0;
        let bYieldCount = b.route.yieldCountMap.get(this.yieldSortBy) || 0;
        const resourceComparison = bYieldCount - aYieldCount;

        if (resourceComparison === 0) {
            return (b.route.importPayloads.length) - (a.route.importPayloads.length);
        }
        return resourceComparison;
    }

    classSort(a, b) {
        if (this.failsAtBottom) {
            const statusComparison = Number(b.route.status == TradeRouteStatus.SUCCESS) -
                Number(a.route.status == TradeRouteStatus.SUCCESS);
            if (statusComparison !== 0) {
                return statusComparison;
            }
        }
        const aClassCount = this.getClassCount(a.route, this.classSortBy);
        const bClassCount = this.getClassCount(b.route, this.classSortBy);
        const stringA = JSON.stringify(aClassCount, null, 2)
        const stringB = JSON.stringify(bClassCount, null, 2)
        const resourceComparison = bClassCount - aClassCount;

        if (resourceComparison === 0) {
            return (b.route.importPayloads.length) - (a.route.importPayloads.length);
        }
        return resourceComparison;
    }

    getRelationshipKey(owner) {
        const dip = Players.get(owner)?.Diplomacy;
        if (!dip) {
            return "PLAYER_RELATIONSHIP_NEUTRAL";
        }
        const localId = GameContext.localPlayerID;
        if (dip.isAtWarWith(localId)) {
            return "PLAYER_RELATIONSHIP_AT_WAR";
        }
        if (dip.hasAllied?.(localId)) {
            return "PLAYER_RELATIONSHIP_ALLIANCE";
        }
        return RELATIONSHIP_TYPE_STRINGS[dip.getRelationshipEnum(localId)] ?? "PLAYER_RELATIONSHIP_NEUTRAL";
    }

    distanceSort(a, b) {
        if (this.failsAtBottom) {
            const statusComparison = Number(b.route.status == TradeRouteStatus.SUCCESS) -
                Number(a.route.status == TradeRouteStatus.SUCCESS);
            if (statusComparison !== 0) {
                return statusComparison;
            }
        }
        // -1 means the engine gave no nearestCityId to measure from, weird, but push those last.
        const aDistance = a.route.distance < 0 ? Number.MAX_SAFE_INTEGER : a.route.distance;
        const bDistance = b.route.distance < 0 ? Number.MAX_SAFE_INTEGER : b.route.distance;
        return aDistance - bDistance;
    }

    getClassCount(route, resourceClass) {
        if (!this.routeClassCounts) {
            this.routeClassCounts = new Map();
        }
        const value = this.routeClassCounts.get(route.city.name);
        if (value !== undefined) {
            return value.get(resourceClass) || 0
        } else {
            const routeClasses = new Map();
            for (const payload of route.importPayloads) {
                const resourceClassType = payload.ResourceClassType;
                routeClasses.set(resourceClassType, (routeClasses.get(resourceClassType) ?? 0) + 1);
            }
            this.routeClassCounts.set(route.city.name, routeClasses)
            return routeClasses.get(resourceClass) || 0
        }
    }

    applySort() {
        if (this.sortMode == "LOC_TRADE_LENS_SORT_DEFAULT") {
            if (this.classSortBy != 'ALL') {
                this.tradeRoutes.sort((a, b) => this.classSort(a, b));
            } else {
                this.tradeRoutes.sort((a, b) => this.defaultSort(a, b));
            }
        } else if (this.sortMode == "LOC_TRADE_LENS_SORT_BY_LEADER") {
            this.tradeRoutes.sort((a, b) => this.leaderSort(a, b));
        } else if (this.sortMode == "LOC_TRADE_LENS_SORT_BY_RESOURCE") {
            if (this.isModern) {
                this.tradeRoutes.sort((a, b) => this.modernResourceSort(a, b));
            }
            this.tradeRoutes.sort((a, b) => this.resourceSort(a, b));           // arrow notation because need this.
        } else if (this.sortMode == "LOC_TRADE_LENS_SORT_BY_YIELD") {
            this.tradeRoutes.sort((a, b) => this.yieldSort(a, b));
        } else if (this.sortMode == "LOC_TRADE_LENS_SORT_BY_DISTANCE") {
            this.tradeRoutes.sort((a, b) => this.distanceSort(a, b));
        }
        for (const route of this.tradeRoutes) {
            if (route.element) {
                this.routesListEl.appendChild(route.element);
            }
        }
    }
    createTradeRouteChooserItem(tradeRoute) {
        const isInvalidRoute = tradeRoute.status != TradeRouteStatus.SUCCESS;
        const routeEle = document.createElement("fxs-chooser-item");
        routeEle.setAttribute("content-direction", "flex-col");
        routeEle.setAttribute("selectable-when-disabled", "true");
        routeEle.setAttribute("select-on-focus", "true");
        routeEle.setAttribute("select-on-activate", "true");
        routeEle.setAttribute("show-frame-on-hover", "false");
        routeEle.setAttribute("data-tooltip-style", "trade-route");
        routeEle.setAttribute("data-tooltip-anchor", "right");
        routeEle.setAttribute("data-tooltip-anchor-offset", "10");
        routeEle.setAttribute("data-trade-route-index", tradeRoute.index.toString());
        routeEle.setAttribute("data-audio-group-ref", "audio-trade-route-chooser");
        routeEle.setAttribute("disabled", isInvalidRoute.toString());
        routeEle.classList.add("my-1\\.5", "flex", "flex-col", "flex-auto");
        const topInfo = document.createElement("div");
        topInfo.classList.add("flex", "flex-row", "mx-4", "mt-4");
        routeEle.appendChild(topInfo);
        const leftInfo = document.createElement("div");
        leftInfo.classList.add("flex", "flex-col", "flex-auto");
        topInfo.appendChild(leftInfo);
        const head = document.createElement("div");
        head.classList.add("flex", "flex-row", "flex-wrap", "items-center");
        head.style.columnGap = "0.6666666667rem";
        const cityName = document.createElement("fxs-header");
        cityName.classList.add("text-base");
        cityName.setAttribute("title", tradeRoute.city.name);
        cityName.setAttribute("filigree-style", "none");
        head.appendChild(cityName);
        leftInfo.appendChild(head);
        const tradeAction = document.createElement("div");
        tradeAction.classList.add("font-body-xs", "mb-1");
        tradeAction.innerHTML = Locale.stylize(tradeRoute.statusText);
        leftInfo.appendChild(tradeAction);
        const rightInfo = document.createElement("div");
        rightInfo.classList.add("flex", "flex-row", "items-start");
        topInfo.appendChild(rightInfo);
        // distance circle+number stacked on top. naval routes get the waves icon as a background layer
        const routeInfoBadge = document.createElement("div");
        routeInfoBadge.classList.add("relative", "size-8", "mr-1");
        if (tradeRoute.distance >= 0) {
            const distanceLocKey = tradeRoute.distanceSource === "UNIT"
                ? "LOC_SLTH_TRADE_DISTANCE_UNIT"
                : "LOC_SLTH_TRADE_DISTANCE_SETTLEMENT";
            routeInfoBadge.setAttribute("data-tooltip-content", Locale.compose(distanceLocKey, tradeRoute.distance));
            const distanceIcon = document.createElement( "fxs-icon");
            distanceIcon.classList.add("size-8", "absolute", "inset-0");
            if (tradeRoute.distanceSource === "SETTLEMENT") {
                distanceIcon.setAttribute("data-icon-id", "SLTH_HUD_DIPLO_HEX_FRAME");
                const distanceHexShadow = document.createElement("fxs-icon");
                distanceHexShadow.classList.add("size-8", "absolute", "inset-0");
                distanceHexShadow.setAttribute("data-icon-id", "SLTH_HUD_DIPLO_HEX_SHADOW");
                routeInfoBadge.appendChild(distanceHexShadow);
            } else {
                distanceIcon.setAttribute("data-icon-id", "SLTH_HUD_SUB_CIRCLE_BK");
            }
            routeInfoBadge.appendChild(distanceIcon);

            const distanceText = document.createElement("fxs-header");
            distanceText.classList.add("absolute", "inset-0", "flex", "items-center", "justify-center", "font-title", "text-shadow-br");
            distanceText.setAttribute("title", tradeRoute.distance.toString());
            distanceText.classList.add(
                tradeRoute.distance < 10 ? "text-xs": "text-2xs"
            );
            distanceText.setAttribute("filigree-style", "none");
            distanceIcon.appendChild(distanceText);
        }
        if (tradeRoute.statusIcon === 'TRADE_ROUTE_SEA') {
            const wavesIcon = document.createElement("fxs-icon");
            wavesIcon.classList.add("size-8", "absolute", "inset-0");
            wavesIcon.setAttribute("data-icon-id", "SLTH_NAVAL_ROUTE_WAVES");
            wavesIcon.setAttribute("data-icon-context", "TRADE");
            wavesIcon.style.transform = "translateY(0.25rem)";
            routeInfoBadge.appendChild(wavesIcon);
        }
        rightInfo.appendChild(routeInfoBadge);
        // leaderColumn stacks leader badge and if a merchant is already headed there, a en-route indicator beneath
        const leaderColumn = document.createElement("div");
        leaderColumn.classList.add("flex", "flex-col", "items-center");
        rightInfo.appendChild(leaderColumn);
        const leaderBg = document.createElement("div");
        leaderBg.classList.add("trade-route-chooser-leader-bg", "size-8", "relative");
        leaderColumn.appendChild(leaderBg);
        const playerColor = UI.Color.getPlayerColors(tradeRoute.city.owner)?.primaryColor ?? {r: 0, g: 0, b: 0, a: 1};
        const playerColorCss = `rgb(${playerColor.r} ${playerColor.g} ${playerColor.b})`;
        const leaderColor = document.createElement("div");
        leaderColor.classList.add("trade-route-chooser-leader-color", "size-8");
        leaderColor.style.filter = `fxs-color-tint(${playerColorCss})`;
        leaderBg.appendChild(leaderColor);
        const leaderIcon = document.createElement("fxs-icon");
        if (tradeRoute.leaderIcon == TradeRouteChooser.MINOR_CIV_LEADER) {
            leaderIcon.classList.add("size-6", "absolute", "inset-1");
        } else {
            leaderIcon.classList.add("size-8", "absolute", "inset-0");
        }
        leaderIcon.setAttribute("data-icon-id", tradeRoute.leaderIcon);
        leaderIcon.setAttribute("data-icon-context", "CIRCLE_MASK");
        leaderBg.appendChild(leaderIcon);
        if (tradeRoute.merchantEnRouteUnitType) {
            // just looks at units being sent to a location
            const enRouteRow = document.createElement("fxs-activatable");
            enRouteRow.classList.add("flex", "flex-row", "items-center");
            enRouteRow.setAttribute("tabindex", "-1");
            enRouteRow.setAttribute(
                "data-tooltip-content",
                Locale.compose("LOC_SLTH_TRADE_MERCHANT_EN_ROUTE", tradeRoute.merchantEnRouteUnitName, tradeRoute.merchantEnRouteTurns)
            );
            enRouteRow.addEventListener("action-activate", (event) => {
                const enRouteUnit = Units.get(tradeRoute.merchantEnRouteUnitId);
                if (enRouteUnit) {
                    Camera.lookAtPlot(enRouteUnit.location, {zoom: 1});
                }
                event.stopPropagation();
            });
            head.appendChild(enRouteRow);

            const enRouteIcon = document.createElement("fxs-icon");
            enRouteIcon.classList.add("size-5", "relative", "-ml-1");
            enRouteIcon.setAttribute("data-icon-id", tradeRoute.merchantEnRouteUnitType);
            enRouteIcon.setAttribute("data-icon-context", "UNIT");
            enRouteRow.appendChild(enRouteIcon);

            const enRouteTurnsText = document.createElement("fxs-header");
            enRouteTurnsText.classList.add("text-base");
            enRouteTurnsText.setAttribute("title", tradeRoute.merchantEnRouteTurns.toString());
            enRouteTurnsText.setAttribute("filigree-style", "none");
            enRouteTurnsText.classList.add("text-sm");
            enRouteRow.appendChild(enRouteTurnsText);
        }
        const payloadInfo = document.createElement("div");
        payloadInfo.classList.add("flex", "flex-row", "mx-4", "mb-2");
        routeEle.appendChild(payloadInfo);
        for (const payload of tradeRoute.importPayloads) {
            const resourceActivatable = document.createElement('fxs-activatable');
            resourceActivatable.setAttribute("data-audio-press-ref", "data-audio-select-press");
            resourceActivatable.classList.add('empire-resource', 'relative');
            resourceActivatable.classList.add('selected');
            resourceActivatable.setAttribute("tabindex", "-1");
            resourceActivatable.classList.add('city-resource', "mr-px", "hover\\:bg-secondary", "focus\\:bg-secondary");
            const tooltipText = Locale.stylize("{1_Name: upper}[N]{2_Class}[N]{3_Tooltip}",
                payload.Name, Locale.compose("LOC_RESOURCECLASS_TOOLTIP_NAME",
                    Locale.compose("LOC_" + payload.ResourceClassType + "_NAME")), payload.Tooltip);
            resourceActivatable.setAttribute('data-tooltip-content', tooltipText);

            const payloadIcon = document.createElement("fxs-icon");
            payloadIcon.classList.add("size-10", "relative");
            payloadIcon.setAttribute("data-icon-id", payload.ResourceType);
            payloadIcon.setAttribute("data-icon-context", "RESOURCE");
            resourceActivatable.appendChild(payloadIcon);
            const payloadType = document.createElement("fxs-icon");
            const resourceTypeIcon = getResourceTypeIcon(payload, tradeRoute.city);
            payloadType.classList.add("size-4", "absolute", "left-3", "-bottom-1");
            payloadType.setAttribute("data-icon-id", resourceTypeIcon);
            payloadType.setAttribute("data-icon-context", "RESOURCECLASS");
            resourceActivatable.appendChild(payloadType);
            payloadInfo.appendChild(resourceActivatable);
        }
        routeEle.addEventListener("chooser-item-selected", (event) => {
            this.handleTradeRouteSelected(routeEle, tradeRoute);
            event.stopPropagation();
        });
        routeEle.addEventListener("action-activate", () => {
            this.checkAndStartTradeRoute();
        });
        return routeEle;
    }
    handleTradeRouteSelected(routeEle, tradeRoute) {
        UI.sendAudioEvent(Audio.getSoundTag("data-audio-trade-route-activate", "audio-trade-route-chooser"));
        Camera.lookAtPlot(tradeRoute.cityPlotIndex);
        if (this.selectedEl) {
            if (this.selectedEl == routeEle) {
                return;
            }
            this.selectedEl.component.selected = false;
        }
        this.selectedEl = routeEle;
        this.selectedRoute = tradeRoute;
        this.updateConfirmButton();
        NavTray.addOrUpdateGenericBack();
        const isValidRoute = tradeRoute.status == TradeRouteStatus.SUCCESS;
        const unit = this.getValidUnitSelection(this.selectedUnitID);
        if (isValidRoute && unit) {
            NavTray.addOrUpdateGenericSelect();
            this.showTradeRoutePathAndBanner();
        }
    }
    tryIssueMoveCommand(city) {
        const unit = this.getValidUnitSelection(this.selectedUnitID);
        if (!unit) {
            console.error("TradeRouteChooser: No valid unit selected to create a trade route with");
            return false;
        }
        this.initializeNavTrayCancelAction();
        const targetCityPlots = city.getPurchasedPlots();
        const distanceCache = /* @__PURE__ */ new Map();
        const locationCache = /* @__PURE__ */ new Map();
        targetCityPlots.sort((a, b) => {
            let distA = distanceCache.get(a);
            let distB = distanceCache.get(b);
            if (distA === void 0) {
                let locationA = locationCache.get(a);
                if (!locationA) {
                    locationA = GameplayMap.getLocationFromIndex(a);
                    locationCache.set(a, locationA);
                }
                distA = GameplayMap.getPlotDistance(unit.location.x, unit.location.y, locationA.x, locationA.y);
                distanceCache.set(a, distA);
            }
            if (distB === void 0) {
                let locationB = locationCache.get(b);
                if (!locationB) {
                    locationB = GameplayMap.getLocationFromIndex(b);
                    locationCache.set(b, locationB);
                }
                distB = GameplayMap.getPlotDistance(unit.location.x, unit.location.y, locationB.x, locationB.y);
                distanceCache.set(b, distB);
            }
            return distA - distB;
        });
        for (const plotIndex of targetCityPlots) {
            const location = locationCache.get(plotIndex) ?? GameplayMap.getLocationFromIndex(plotIndex);
            const pathTo = Units.getPathTo(unit.id, location);
            if (pathTo.plots.length === 0) {
                continue;
            }
            const success = WorldInput.requestMoveOperation(unit.id, { X: location.x, Y: location.y });
            if (success) {
                return true;
            }
        }
        return false;
    }
    showTradeRoutePathAndBanner() {
        TradeRoutesModel.clearTradeRouteVfx();
        this.tradeRouteBanner?.remove();
        if (this.selectedRoute) {
            TradeRoutesModel.showTradeRouteVfx(this.selectedRoute.pathPlots);
            this.tradeRouteBanner = document.createElement("trade-route-banner");
      this.tradeRouteBanner.whenComponentCreated((banner) => {
        banner.routeInfo = this.selectedRoute;
      });
      UnitFlagManager.instance.Root.appendChild(this.tradeRouteBanner);
        }
    }
    checkAndStartTradeRoute(checkOnly = false) {
        if (!this.selectedRoute) {
            console.log(`TradeRouteChooser: No route to create a trade with`);
            return false;
        }
        const selectedUnitID = UI.Player.getHeadSelectedUnit();
        if (!selectedUnitID) {
            console.log("TradeRouteChooser: No merchant selected to create a trade route with");
            return false;
        }
        const targetLocation = this.selectedRoute.city.location;
        const actionParams = { X: targetLocation.x, Y: targetLocation.y };
        if (checkOnly) {
            return !this.isModern || Game.UnitCommands.canStart(selectedUnitID, UnitCommandTypes.MAKE_TRADE_ROUTE, actionParams, false).Success;
        } else {
            let commandValid = Game.UnitCommands.canStart(
                selectedUnitID,
                UnitCommandTypes.MAKE_TRADE_ROUTE,
                actionParams,
                false
            ).Success;
            if (commandValid) {
                Game.UnitCommands.sendRequest(selectedUnitID, UnitCommandTypes.MAKE_TRADE_ROUTE, actionParams);
            } else {
                commandValid = this.tryIssueMoveCommand(this.selectedRoute.city);
            }
            InterfaceMode.switchToDefault();
            this.close();
            return commandValid;
        }
    }

    setupResourceSelector(frame) {
        const availableResourceTypes = new Set();
        this.tradeRoutes.forEach(item => {
            if (item.route.resourceCount instanceof Map) {
                for (const key of item.route.resourceCount.keys()) {
                    availableResourceTypes.add(key);
                }
            }
        });
        const resourceTypes = [...availableResourceTypes]
            .filter(resource => !(resource.includes("DISTANT_LANDS")))
            .sort((a, b) => {
            const valueA = resourceTableMap.get(a).ResourceClassType || '';
            const valueB = resourceTableMap.get(b).ResourceClassType || '';
            const valueComparison = valueA.localeCompare(valueB)
            if (valueComparison === 0) {
                return a.localeCompare(b);
            }
            return valueA.localeCompare(valueB);
        });

        const resourceOptions = resourceTypes.filter(resource => !(this.isModern && resource.includes("DISTANT_LANDS"))).map(resource => {
            const resourceSimple = resource.replace("RESOURCE_", "")
            const displayText = resourceSimple.charAt(0).toUpperCase() + resourceSimple.slice(1).toLowerCase();
            return {
                label: displayText,  // What shows in the dropdown
                value: resource      // data value used for sorting
            };
        }).sort((a, b) => a.label.localeCompare(b.label));

        if (resourceOptions.length > 0) {
            this.resourceSortBy = resourceOptions[0].value;
        } else {
            this.resourceSortBy = 'RESOURCE_FISH';
        }

        this.resourceSelector = document.createElement("div");
        this.resourceSelector.classList.add("flex", "flex-col", "gap-1\\.5", "ml-3", "mt-1\\.5");
        frame.appendChild(this.resourceSelector);
        const columns = 8;
        let i = 0;
        let gridLine = document.createElement("div");
        gridLine.classList.add("flex", "flex-row", "flex-wrap", "gap-1\\.5");
        let cached_resource = resourceTableMap.get(resourceTypes[0])
        for (const resource of resourceTypes) {
            if (resourceTableMap.get(resource).ResourceClassType !== cached_resource.ResourceClassType) {
                this.resourceSelector.appendChild(gridLine);
                gridLine = document.createElement("div");
                gridLine.classList.add("flex", "flex-row", "flex-wrap", "gap-1\\.5");
                i = 0;
            }
            cached_resource = resourceTableMap.get(resource)

            const selectionElement = document.createElement("fxs-chooser-item");
            selectionElement.setAttribute("select-on-focus", "true");
            selectionElement.setAttribute("show-frame-on-hover", "false");
            selectionElement.setAttribute('data-tooltip-anchor', "right");
            selectionElement.setAttribute("data-audio-group-ref", "audio-trade-route-chooser");
            selectionElement.setAttribute("data-icon-id", resource);
            selectionElement.setAttribute("select-on-activate", "true");
            const tooltipText = Locale.stylize("{1_Name: upper}[N]{2_Class}[N]{3_Tooltip}",
                cached_resource.Name, Locale.compose("LOC_RESOURCECLASS_TOOLTIP_NAME",
                    Locale.compose("LOC_" + cached_resource.ResourceClassType + "_NAME")), cached_resource.Tooltip);
            selectionElement.setAttribute('data-tooltip-content', tooltipText);
            selectionElement.addEventListener('chooser-item-selected', this.resourceTracker);
            gridLine.appendChild(selectionElement);

            const resourceIcon = document.createElement("fxs-icon");
            resourceIcon.classList.add("size-10", "relative");
            resourceIcon.setAttribute("data-icon-id", resource);
            resourceIcon.setAttribute("data-icon-context", "RESOURCE");
            selectionElement.appendChild(resourceIcon);
            if (i % columns === 0) {
                const resourceType = document.createElement("fxs-icon");
                resourceType.classList.add("size-4", "absolute", "left-3", "-bottom-1");
                resourceType.setAttribute("data-icon-id", cached_resource.ResourceClassType);
                resourceType.setAttribute("data-icon-context", "RESOURCECLASS");
                resourceIcon.appendChild(resourceType);
            }
            i += 1
            gridLine.appendChild(selectionElement);
        }
        this.resourceSelector.classList.add("hidden");
        this.resourceSelector.appendChild(gridLine);
    }

    setupYieldSelector(frame) {
        const yieldTypes = new Set([]);
        this.tradeRoutes.forEach(item => {
            if (item.route.resourceCount instanceof Map) {
                for (const [key, value] of item.route.yieldCountMap.entries()) {
                    if (value > 0) {
                        yieldTypes.add(key);
                    }
                }
            }
        });

        // Predefined order
        const order = ['YIELD_FOOD', 'YIELD_PRODUCTION', 'YIELD_GOLD', 'YIELD_SCIENCE', 'YIELD_CULTURE',
            'YIELD_HAPPINESS', 'YIELD_DIPLOMACY']

        const orderedYields = [];

        // First add items that are in the predefined order
        order.forEach(key => {
            if (yieldTypes.has(key)) {
                orderedYields.push(key);
            }
        });

        // Then add remaining items that weren't in the predefined order, in case of some crazy yield mod (its me lol)
        yieldTypes.forEach(item => {
            if (!order.includes(item)) {
                orderedYields.push(item);
            }
        });

        if (orderedYields.length > 0) {
            this.yieldSortBy = orderedYields[0].value;
        } else {
            this.yieldSortBy = 'YIELD_HAPPINESS';
        }

        this.yieldSelector = document.createElement("div");
        this.yieldSelector.classList.add("flex", "flex-row", "gap-1\\.5", "ml-3", "my-1\\.5");
        frame.appendChild(this.yieldSelector);
        for (const yieldType of orderedYields) {
            const selectionElement = document.createElement("fxs-chooser-item");
            selectionElement.setAttribute("select-on-focus", "true");
            selectionElement.setAttribute("show-frame-on-hover", "false");
            selectionElement.setAttribute("data-audio-group-ref", "audio-trade-route-chooser");
            selectionElement.setAttribute("data-icon-id", yieldType);
            selectionElement.setAttribute("select-on-activate", "true");
            selectionElement.addEventListener('chooser-item-selected', this.yieldTracker);
            this.yieldSelector.appendChild(selectionElement);
            const yieldTypeIcon = document.createElement("fxs-icon");
            yieldTypeIcon.classList.add("size-10", "relative");
            yieldTypeIcon.setAttribute("data-icon-id", yieldType);
            yieldTypeIcon.setAttribute("data-icon-context", "DEFAULT");
            selectionElement.appendChild(yieldTypeIcon);
        }
        this.yieldSelector.classList.add("hidden");
    }

    setupClassSelector(frame) {
        const resourceClasses = ['ALL', 'RESOURCECLASS_BONUS', 'RESOURCECLASS_CITY', 'RESOURCECLASS_EMPIRE']
        if (this.isModern) {
            resourceClasses.push('RESOURCECLASS_FACTORY')
        }
        if (this.isExploration) {
            resourceClasses.push('RESOURCECLASS_TREASURE')
        }

        this.classSortBy = resourceClasses[0];

        this.classSelector = document.createElement("div");
        this.classSelector.classList.add("flex", "flex-row", "gap-1\\.5", "ml-3", "my-1\\.5");
        frame.appendChild(this.classSelector);
        for (const classType of resourceClasses) {
            const selectionElement = document.createElement("fxs-chooser-item");
            selectionElement.setAttribute("select-on-focus", "true");
            selectionElement.setAttribute("show-frame-on-hover", "false");
            selectionElement.setAttribute("data-audio-group-ref", "audio-trade-route-chooser");
            selectionElement.setAttribute("data-icon-id", classType);                   // dont work
            selectionElement.setAttribute("select-on-activate", "true");
            selectionElement.addEventListener('chooser-item-selected', this.classTracker);
            const tooltipText = Locale.compose(`LOC_${classType}_NAME`)
            selectionElement.setAttribute('data-tooltip-content', tooltipText);
            this.classSelector.appendChild(selectionElement);
            const classTypeIcon = document.createElement("fxs-icon");
            classTypeIcon.classList.add("size-10", "relative");
            classTypeIcon.setAttribute("data-icon-id", classType === 'ALL' ? 'RADIAL_RESOURCES' : classType);
            classTypeIcon.setAttribute("data-icon-context", "RESOURCECLASS");
            selectionElement.appendChild(classTypeIcon);
        }
    }

    setupLeaderSelector(frame) {
        // grouping city states together, had to use Players.get(owner).isMinor, because of weird city states
        // modded that don't have a leaderType that resolves. Same with regular players as could have duplicates.
        const leadersByKey = new Map();
        this.tradeRoutes.forEach(item => {
            const route = item.route;
            const isMinorCiv = Players.get(route.city.owner)?.isMinor === true;
            const key = isMinorCiv ? TradeRouteChooser.MINOR_CIV_LEADER : route.city.owner;
            if (!leadersByKey.has(key)) {
                leadersByKey.set(key, {
                    key,
                    isGroup: isMinorCiv,
                    leaderIcon: isMinorCiv ? TradeRouteChooser.MINOR_CIV_LEADER : route.leaderIcon,
                    leaderName: isMinorCiv ? "City-States" : route.leaderName
                });
            }
        });
        const leaders = Array.from(leadersByKey.values()).sort((a, b) => a.leaderName.localeCompare(b.leaderName));

        this.leaderSortBy = leaders.length > 0 ? leaders[0].key : -1;

        this.leaderSelector = document.createElement("div");
        this.leaderSelector.classList.add("flex", "flex-row", "flex-wrap", "gap-1\\.5", "ml-3", "mt-1\\.5", "hidden");
        frame.appendChild(this.leaderSelector);
        for (const leader of leaders) {
            const selectionElement = document.createElement("fxs-chooser-item");
            selectionElement.setAttribute("select-on-focus", "true");
            selectionElement.setAttribute("show-frame-on-hover", "false");
            selectionElement.setAttribute("data-audio-group-ref", "audio-trade-route-chooser");
            selectionElement.setAttribute("data-icon-id", leader.key.toString());
            selectionElement.setAttribute("select-on-activate", "true");
            // The grouped City-States entry has no relationship because it's grouped. Also since the name of city
            // state is the city, you should know if they are your suzerain.
            const leaderTooltip = leader.isGroup
                ? leader.leaderName
                : Locale.stylize(`{1_LeaderName}[N][icon:${this.getRelationshipKey(leader.key)}] {2_RelationshipName}: {3_Amount}`,
                    leader.leaderName,
                    Locale.compose("LOC_" + this.getRelationshipKey(leader.key)),
                    this.getRelationshipAmount(leader.key));
            selectionElement.setAttribute('data-tooltip-content', leaderTooltip);
            selectionElement.addEventListener('chooser-item-selected', this.leaderTracker);
            this.leaderSelector.appendChild(selectionElement);

            const leaderBg = document.createElement("div");
            leaderBg.classList.add("trade-route-chooser-leader-bg", "size-10", "relative");
            selectionElement.appendChild(leaderBg);

            // The grouped city-state entry just uses neutral tint
            const playerColor = leader.isGroup
                ? {r: 255, g: 255, b: 255, a: 1}
                : (UI.Color.getPlayerColors(leader.key)?.primaryColor ?? {r: 0, g: 0, b: 0, a: 1});
            const playerColorCss = `rgb(${playerColor.r} ${playerColor.g} ${playerColor.b})`;
            const leaderColor = document.createElement("div");
            leaderColor.classList.add("trade-route-chooser-leader-color", "size-10");
            leaderColor.style.filter = `fxs-color-tint(${playerColorCss})`;
            leaderBg.appendChild(leaderColor);

            const leaderIcon = document.createElement("fxs-icon");
            if (leader.isGroup) {
                leaderIcon.classList.add("size-8", "absolute", "inset-1");
            } else {
                leaderIcon.classList.add("size-10", "absolute", "inset-0");
            }
            leaderIcon.setAttribute("data-icon-id", leader.leaderIcon);
            leaderIcon.setAttribute("data-icon-context", "CIRCLE_MASK");
            leaderBg.appendChild(leaderIcon);
        }
    }

    // Combined with leader tab
    setupRelationshipSelector(frame) {
        const relationshipTypes = new Set();
        this.tradeRoutes.forEach(item => {
            relationshipTypes.add(this.getRelationshipKey(item.route.city.owner));
        });

        this.relationshipSelector = document.createElement("div");
        this.relationshipSelector.classList.add("flex", "flex-row", "flex-wrap", "gap-1\\.5", "ml-3", "my-1\\.5", "hidden");
        frame.appendChild(this.relationshipSelector);
        for (const relationshipType of RELATIONSHIP_ORDER) {
            const selectionElement = document.createElement("fxs-chooser-item");
            selectionElement.setAttribute("select-on-focus", "true");
            selectionElement.setAttribute("show-frame-on-hover", "false");
            selectionElement.setAttribute("data-audio-group-ref", "audio-trade-route-chooser");
            selectionElement.setAttribute("data-icon-id", relationshipType);
            selectionElement.setAttribute(
                "disabled",
                relationshipTypes.has(relationshipType) ? "false" : "true"
            );
            selectionElement.setAttribute("select-on-activate", "true");
            selectionElement.setAttribute('data-tooltip-content', Locale.compose("LOC_" + relationshipType));
            selectionElement.addEventListener('chooser-item-selected', this.leaderTracker);
            this.relationshipSelector.appendChild(selectionElement);

            const relationshipIcon = document.createElement("fxs-icon");
            relationshipIcon.classList.add("size-10", "relative");
            relationshipIcon.setAttribute("data-icon-id", relationshipType);
            relationshipIcon.setAttribute("data-icon-context", "PLAYER_RELATIONSHIP");
            selectionElement.appendChild(relationshipIcon);
        }
    }

    setupSortModeSelector(container) {
        this.sortModeSelector = document.createElement("div");
        this.sortModeSelector.classList.add("flex", "flex-row", "gap-1\\.5", "ml-3");
        container.appendChild(this.sortModeSelector);
        for (const sortModeDef of SORT_MODES) {
            const selectionElement = document.createElement("fxs-chooser-item");
            selectionElement.setAttribute("select-on-focus", "true");
            selectionElement.setAttribute("show-frame-on-hover", "false");
            selectionElement.setAttribute("data-audio-group-ref", "audio-trade-route-chooser");
            selectionElement.setAttribute("data-sort-mode", sortModeDef.mode);
            selectionElement.setAttribute("select-on-activate", "true");
            selectionElement.setAttribute("data-audio-focus-ref", "none");
            selectionElement.setAttribute('data-tooltip-content', sortModeDef.mode);
            selectionElement.addEventListener('chooser-item-selected', this.sortModeTracker);
            selectionElement.addEventListener('focus', () => {
                this.selectedEl = null;
                NavTray.removeGenericSelect();
            });
            this.sortModeSelector.appendChild(selectionElement);

            const modeIcon = document.createElement("fxs-icon");
            modeIcon.classList.add("size-10", "relative");
            modeIcon.setAttribute("data-icon-id", sortModeDef.icon);
            modeIcon.setAttribute("data-icon-context", sortModeDef.context);
            selectionElement.appendChild(modeIcon);
        }
    }

    // Shows the icon-selector row matching the active sort mode and hides the rest.
    updateSelectorVisibilityForSortMode() {
        this.resourceSelector.classList.toggle("hidden", this.sortMode !== "LOC_TRADE_LENS_SORT_BY_RESOURCE");
        this.yieldSelector.classList.toggle("hidden", this.sortMode !== "LOC_TRADE_LENS_SORT_BY_YIELD");
        this.classSelector.classList.toggle("hidden", this.sortMode !== "LOC_TRADE_LENS_SORT_DEFAULT");
        // one toggle covers leaderSelector and relationshipSelector
        this.leaderSelector.classList.toggle("hidden", this.sortMode !== "LOC_TRADE_LENS_SORT_BY_LEADER");
        this.relationshipSelector.classList.toggle("hidden", this.sortMode !== "LOC_TRADE_LENS_SORT_BY_LEADER");
    }

    onSwitchSortModeActivate(event) {
        if (this.sortModeSelectionComponent != event.currentTarget) {
            if (this.sortModeSelectionComponent) {
                this.sortModeSelectionComponent.component.selected = false;
            }
            this.sortModeSelectionComponent = event.currentTarget;
            if (event.target instanceof HTMLElement) {
                this.sortMode = event.currentTarget.getAttribute('data-sort-mode');
                this.updateSelectorVisibilityForSortMode();
                this.applySort();
            }
        }
    }

    // Gamepad L1/R1 (SHELL_PREVIOUS/SHELL_NEXT) cycling, replacing the old
    // fxs-selector's built-in selectPrevious()/selectNext().
    cycleSortMode(delta) {
        const currentIndex = SORT_MODES.findIndex(m => m.mode === this.sortMode);
        const nextIndex = (currentIndex + delta + SORT_MODES.length) % SORT_MODES.length;
        const nextItem = this.sortModeSelector.children[nextIndex];
        if (this.sortModeSelectionComponent) {
            this.sortModeSelectionComponent.component.selected = false;
        }
        this.sortModeSelectionComponent = nextItem;
        if (nextItem?.component) {
            nextItem.component.selected = true;
        }
        this.sortMode = SORT_MODES[nextIndex].mode;
        this.updateSelectorVisibilityForSortMode();
        this.applySort();
    }

    onTrackFailsActivate(event) {
        if (event.target instanceof HTMLElement) {
            const isCurrentlyTracked = event.target.getAttribute('selected');
            this.failsAtBottom = isCurrentlyTracked === 'true' ? true : false;
            this.applySort();
        }
    }

    onSwitchResourceActivate(event) {
        if (this.resourceSelectionComponent != event.currentTarget) {
            if (this.resourceSelectionComponent) {
                this.resourceSelectionComponent.component.selected = false;
            }
            this.resourceSelectionComponent = event.currentTarget;
            if (event.target instanceof HTMLElement) {
                this.resourceSortBy = event.currentTarget.getAttribute('data-icon-id');
                this.applySort();
            }
        }
    }

    onSwitchYieldActivate(event) {
        if (this.yieldSelectionComponent != event.currentTarget) {
            if (this.yieldSelectionComponent) {
                this.yieldSelectionComponent.component.selected = false;
            }
            this.yieldSelectionComponent = event.currentTarget;
            if (event.target instanceof HTMLElement) {
                this.yieldSortBy = event.currentTarget.getAttribute('data-icon-id');
                this.applySort();
            }
        }
    }

    onSwitchClassActivate(event) {
        if (this.classSelectionComponent != event.currentTarget) {
            if (this.classSelectionComponent) {
                this.classSelectionComponent.component.selected = false;
            }
            this.classSelectionComponent = event.currentTarget;
            if (event.target instanceof HTMLElement) {
                this.classSortBy = event.currentTarget.getAttribute('data-icon-id');
                this.applySort();
            }
        }
    }

    // Handles both leader icons and relationship icons, since they share one tab
    onSwitchLeaderActivate(event) {
        if (this.leaderSelectionComponent != event.currentTarget) {
            if (this.leaderSelectionComponent) {
                this.leaderSelectionComponent.component.selected = false;
            }
            this.leaderSelectionComponent = event.currentTarget;
            if (event.target instanceof HTMLElement) {
                const rawValue = event.currentTarget.getAttribute('data-icon-id');
                if (rawValue === TradeRouteChooser.MINOR_CIV_LEADER || rawValue.startsWith("PLAYER_RELATIONSHIP_")) {
                    this.leaderSortBy = rawValue;
                } else {
                    this.leaderSortBy = Number(rawValue);
                }
                this.applySort();
            }
        }
    }
}
Controls.define("trade-route-chooser", {
    createInstance: TradeRouteChooser,
    description: "Select and get info on trade routes.",
    classNames: ["trade-route-chooser"],
    styles: [styles],
    tabIndex: -1
});
//# sourceMappingURL=trade-route-chooser.js.map
