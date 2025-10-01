import {A as Audio} from '/core/ui/input/focus-manager.js';
import {F as Focus} from '/core/ui/input/focus-support.chunk.js';
import {InterfaceMode} from '../../../core/ui/interface-modes/interface-modes.js';
import {C as CityBannerManager} from '/base-standard/ui/city-banners/city-banner-manager.chunk.js';
import {TradeRoutesModel, getResourceTypeIcon} from '/base-standard/ui/trade-route-chooser/trade-routes-model.js';
import ActionHandler, {ActiveDeviceTypeChangedEventName} from '/core/ui/input/action-handler.js';
import {N as NavTray} from '/core/ui/navigation-tray/model-navigation-tray.chunk.js';
import {P as Panel} from '/core/ui/panel-support.chunk.js';
import {L as LensManager} from '/core/ui/lenses/lens-manager.chunk.js';
import WorldInput from '/base-standard/ui/world-input/world-input.js';

const styles = "fs://game/base-standard/ui/trade-route-chooser/trade-route-chooser.css";


const resourceTableMap = new Map()
GameInfo.Resources.forEach(i => {
    resourceTableMap.set(i.ResourceType, i)
})

class TradeRouteChooser extends Panel {
    static _activeChooser;
    tradeRoutes;
    isModern = Game.age == Database.makeHash("AGE_MODERN");
    isExploration = Game.age == Database.makeHash("AGE_EXPLORATION");
    frame = document.createElement("fxs-subsystem-frame");
    sortOrder = document.createElement("fxs-selector");
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

        this.frame = document.createElement("fxs-subsystem-frame");
        this.sortOrder = document.createElement("fxs-selector");
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
        headerContainer.classList.add("header-container");
        headerContainer.style.display = "flex";
        headerContainer.style.flexDirection = "row";
        headerContainer.setAttribute("data-slot", "header");
        this.frame.appendChild(headerContainer);

        this.checkBoxText = document.createElement('p');
        this.checkBoxText.classList.add('font-title-sm', 'leading-loose', 'text-gradient-secondary');
        this.checkBoxText.classList.add("text-center", "font-body-sm");
        this.checkBoxText.style.marginLeft = "1rem";
        this.checkBoxText.innerHTML = Locale.compose('LOC_SLTH_TRADE_TICKBOX');
        headerContainer.appendChild(this.checkBoxText);

        this.checkBox = document.createElement('fxs-checkbox');
        this.checkBox.setAttribute('selected', `${this.failsAtBottom}`);
        this.checkBox.setAttribute("tabindex", "-1");
        this.checkBox.classList.add('advisor-victory_tracker', 'size-7', 'mr-4');
        headerContainer.appendChild(this.checkBox);


        const sortOptions = [{label: "LOC_TRADE_LENS_SORT_DEFAULT"}, {label: "LOC_TRADE_LENS_SORT_BY_LEADER"},
            {label: "LOC_TRADE_LENS_SORT_BY_RESOURCE"}, {label: "LOC_TRADE_LENS_SORT_BY_YIELD"}];
        this.sortOrder.classList.add("m-4", "font-body-lg");
        this.sortOrder.setAttribute("enable-shell-nav", "true");
        this.sortOrder.setAttribute("data-slot", "header");
        this.sortOrder.setAttribute("selected-item-index", "0");
        this.sortOrder.componentCreatedEvent.on((component) => component.updateSelectorItems(sortOptions));
        this.sortOrder.setAttribute("data-audio-focus-ref", "none");
        headerContainer.appendChild(this.sortOrder);

        this.setupResourceSelector(this.frame)
        this.setupUpdateSecondSorter()
        this.setupYieldSelector(this.frame)
        this.setupClassSelector(this.frame)

        this.routesListEl.setAttribute("disable-focus-allowed", "true");
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
            const actionParams = {X: targetLocation.x, Y: targetLocation.y};
            canStartTradeRoute = Game.UnitCommands.canStart(unit.id, UnitCommandTypes.MAKE_TRADE_ROUTE, actionParams, false).Success;
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
                this.confirmButton.setAttribute("data-tooltip-content", this.isModern || canStartTradeRoute ? "LOC_TRADE_LENS_CONFIRM_ROUTE_TOOLTIP" : "LOC_TRADE_LENS_SEND_MERCHANT_TOOLTIP");
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
    }

    onUnitSelectionChanged({selected, unit}) {
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
            this.sortOrder.component.selectPrevious();
            Focus.setContextAwareFocus(this.routesListEl, this.Root);
            event.stopPropagation();
        } else if (direction == InputNavigationAction.SHELL_NEXT) {
            this.sortOrder.component.selectNext();
            Focus.setContextAwareFocus(this.routesListEl, this.Root);
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
        return b.route.leaderName.localeCompare(a.route.leaderName);
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
        }
        this.routesListEl.innerHTML = "";
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
        routeEle.classList.add("mx-3", "my-1\\.5", "flex", "flex-col", "flex-auto");
        const topInfo = document.createElement("div");
        topInfo.classList.add("flex", "flex-row", "mx-4", "mt-4");
        routeEle.appendChild(topInfo);
        const leftInfo = document.createElement("div");
        leftInfo.classList.add("flex", "flex-col", "flex-auto");
        topInfo.appendChild(leftInfo);
        const cityName = document.createElement("fxs-header");
        cityName.classList.add("text-base");
        cityName.setAttribute("title", tradeRoute.city.name);
        cityName.setAttribute("filigree-style", "none");
        leftInfo.appendChild(cityName);
        const tradeAction = document.createElement("div");
        tradeAction.classList.add("font-body-sm", "mr-2");
        tradeAction.innerHTML = Locale.stylize(tradeRoute.statusText);
        leftInfo.appendChild(tradeAction);
        const rightInfo = document.createElement("div");
        rightInfo.classList.add("flex", "flex-row");
        topInfo.appendChild(rightInfo);
        const routeIcon = document.createElement("fxs-icon");
        routeIcon.classList.add("size-8");
        routeIcon.setAttribute("data-icon-id", tradeRoute.statusIcon);
        routeIcon.setAttribute("data-icon-context", "TRADE");
        rightInfo.appendChild(routeIcon);
        const leaderBg = document.createElement("div");
        leaderBg.classList.add("trade-route-chooser-leader-bg", "size-8", "relative");
        rightInfo.appendChild(leaderBg);
        const playerColor = UI.Color.getPlayerColors(tradeRoute.city.owner)?.primaryColor ?? {r: 0, g: 0, b: 0, a: 1};
        const playerColorCss = `rgb(${playerColor.r} ${playerColor.g} ${playerColor.b})`;
        const leaderColor = document.createElement("div");
        leaderColor.classList.add("trade-route-chooser-leader-color", "size-8");
        leaderColor.style.filter = `fxs-color-tint(${playerColorCss})`;
        leaderBg.appendChild(leaderColor);
        const leaderIcon = document.createElement("fxs-icon");
        leaderIcon.classList.add("size-8", "absolute", "inset-0");
        leaderIcon.setAttribute("data-icon-id", tradeRoute.leaderIcon);
        leaderIcon.setAttribute("data-icon-context", "CIRCLE_MASK");
        leaderBg.appendChild(leaderIcon);
        const payloadInfo = document.createElement("div");
        payloadInfo.classList.add("flex", "flex-row", "mx-4", "mb-4");
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
            if (resourceTypeIcon == "RESOURCECLASS_TREASURE_FLEET") {
                payloadType.classList.add("size-8", "absolute", "left-0", "-bottom-2");
            } else {
                payloadType.classList.add("size-4", "absolute", "left-0", "bottom-0");
            }
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
            const success = WorldInput.requestMoveOperation(unit.id, {X: location.x, Y: location.y});
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
            this.tradeRouteBanner.componentCreatedEvent.on((banner) => banner.routeInfo = this.selectedRoute);
            CityBannerManager.instance.Root.appendChild(this.tradeRouteBanner);
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
        const actionParams = {X: targetLocation.x, Y: targetLocation.y};
        if (checkOnly) {
            return !this.isModern || Game.UnitCommands.canStart(selectedUnitID, UnitCommandTypes.MAKE_TRADE_ROUTE, actionParams, false).Success;
        } else {
            let commandValid = Game.UnitCommands.canStart(selectedUnitID, UnitCommandTypes.MAKE_TRADE_ROUTE, actionParams, false).Success;
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
        let resourceTypes = new Set();

        this.tradeRoutes.forEach(item => {
            if (item.route.resourceCount instanceof Map) {
                for (const key of item.route.resourceCount.keys()) {
                    resourceTypes.add(key);
                }
            }
        });

        resourceTypes = Array.from(resourceTypes).filter(resource => !(resource.includes("DISTANT_LANDS"))).sort((a, b) => {
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
                value: resource      // The actual data value used for sorting
            };
        }).sort((a, b) => a.label.localeCompare(b.label));

        if (resourceOptions.length > 0) {
            this.resourceSortBy = resourceOptions[0].value;
        } else {
            this.resourceSortBy = 'RESOURCE_FISH';
        }

        this.resourceSelector = document.createElement("div");
        this.resourceSelector.classList.add("flex", "flex-col", "mx-4", "mb-4");
        frame.appendChild(this.resourceSelector);
        const limiter = 8;
        let i = 0;
        let gridLine = document.createElement("div");
        gridLine.classList.add("flex", "flex-row", "mx-4", "mb-4");
        let cached_resource = resourceTableMap.get(resourceTypes[0])
        for (const resource of resourceTypes) {
            if (i === limiter || resourceTableMap.get(resource).ResourceClassType !== cached_resource.ResourceClassType) {
                this.resourceSelector.appendChild(gridLine);
                gridLine = document.createElement("div");
                gridLine.classList.add("flex", "flex-row", "mx-4", "mb-4");
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
            if (i === 0) {
                const resourceType = document.createElement("fxs-icon");
                resourceType.classList.add("size-4", "absolute", "left-0", "bottom-0");
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

        // Then add remaining items that weren't in the predefined order
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
        this.yieldSelector.classList.add("flex", "flex-row", "mx-4", "mb-4");
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
        this.classSelector.classList.add("flex", "flex-row", "mx-4", "mb-4");
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
            if (classType !== 'ALL') {
                const classTypeIcon = document.createElement("fxs-icon");
                classTypeIcon.classList.add("size-10", "relative");
                classTypeIcon.setAttribute("data-icon-id", classType);
                classTypeIcon.setAttribute("data-icon-context", "RESOURCECLASS");
                selectionElement.appendChild(classTypeIcon);
            } else {
                const description = document.createElement("div");
                description.classList.add("text-center", "mx-2\\.5", "font-body-sm");
                description.setAttribute("data-slot", "header");
                description.classList.add("text-center", "font-body-sm");
                description.style.flexShrink = "1";
                description.style.minWidth = "0";
                description.innerHTML = 'All';
                selectionElement.appendChild(description);
            }
        }
    }

    setupUpdateSecondSorter() {
        this.sortOrder.addEventListener("dropdown-selection-change", (ev) => {
            this.sortMode = ev.detail.selectedItem?.label ?? "LOC_TRADE_LENS_SORT_DEFAULT";
            if (this.sortMode === "LOC_TRADE_LENS_SORT_BY_RESOURCE") {
                this.resourceSelector.classList.remove("hidden");
            } else {
                this.resourceSelector.classList.add("hidden");
            }
            if (this.sortMode === "LOC_TRADE_LENS_SORT_BY_YIELD") {
                this.yieldSelector.classList.remove("hidden");
            } else {
                this.yieldSelector.classList.add("hidden");
            }
            if (this.sortMode === "LOC_TRADE_LENS_SORT_DEFAULT") {
                this.classSelector.classList.remove("hidden");
            } else {
                this.classSelector.classList.add("hidden");
            }
            this.applySort();
        });
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

}

Controls.define("trade-route-chooser", {
    createInstance: TradeRouteChooser,
    description: "Select and get info on trade routes.",
    classNames: ["trade-route-chooser"],
    styles: [styles],
    tabIndex: -1
});

//# sourceMappingURL=trade-route-chooser.js.map
