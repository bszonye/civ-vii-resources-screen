/**
 * @file trade-route-chooser.ts
 * @copyright 2024, Firaxis Games
 * @description Select and get info on trade trade routes
 */
import { Audio } from '/core/ui/audio-base/audio-support.js';
import CityBannerManager from '/base-standard/ui/city-banners/city-banner-manager.js';
import { TradeRoutesModel } from '/base-standard/ui/trade-route-chooser/trade-routes-model.js';
import ContextManager from '/core/ui/context-manager/context-manager.js';
import ActionHandler, { ActiveDeviceTypeChangedEventName } from '/core/ui/input/action-handler.js';
import NavTray from '/core/ui/navigation-tray/model-navigation-tray.js';
import Panel from '/core/ui/panel-support.js';
import ViewManager from '/core/ui/views/view-manager.js';
import { Focus } from '/core/ui/input/focus-support.js';

const log_level = 'happy'
const resourceClassMap = new Map()
GameInfo.Resources.forEach(i => {
    resourceClassMap.set(i.ResourceType, i.ResourceClassType)
})

class TradeRouteChooser extends Panel {
    static get activeChooser() {
        return this._activeChooser;
    }
    constructor(root) {
        super(root);
        this.isModern = Game.age == Database.makeHash("AGE_MODERN");
        this.failsAtBottom = true
        this.failsAtBottomTracker = this.onTrackFailsActivate.bind(this);
        this.resourceTracker = this.onSwitchResourceActivate.bind(this);
        this.yieldTracker = this.onSwitchYieldActivate.bind(this);
        this.sortOrder = document.createElement("fxs-selector");
        this.routesListEl = document.createElement("fxs-vslot");
        this.sortMode = "LOC_TRADE_LENS_SORT_DEFAULT";
        this.navigateInputListener = this.onNavigateInput.bind(this);
        this.activeDeviceTypeListener = this.updateInputDeviceType.bind(this);
        this.engineInputListener = this.onEngineInput.bind(this);
        this.tradeRoutes = TradeRoutesModel
            .getProjectedTradeRoutes()
            .map(route => ({ route: route, element: this.createTradeRouteChooserItem(route) }));
        const fragment = document.createDocumentFragment();
        const frame = document.createElement("fxs-subsystem-frame");
        frame.setAttribute("no-close", "true");
        fragment.appendChild(frame);
        const titleContainer = document.createElement("div");
        titleContainer.classList.add("header-container");
        titleContainer.style.display = "flex";
        titleContainer.style.flexDirection = "row";
        titleContainer.setAttribute("data-slot", "header");
        frame.appendChild(titleContainer);

        const title = document.createElement("fxs-header");
        title.setAttribute("title", this.isModern ? "LOC_TRADE_LENS_TITLE_ALT" : "LOC_TRADE_LENS_TITLE");
        title.style.marginLeft = "1rem";
        titleContainer.appendChild(title)

        const checkBoxText = document.createElement('p');
        checkBoxText.classList.add('font-title-sm', 'leading-loose', 'text-gradient-secondary');
        checkBoxText.classList.add("text-center", "font-body-sm");
        checkBoxText.style.marginLeft = "1rem";
        checkBoxText.innerHTML = Locale.compose('LOC_SLTH_TRADE_TICKBOX');
        titleContainer.appendChild(checkBoxText);

        const checkBox = document.createElement('fxs-checkbox');
        checkBox.setAttribute('selected', `${this.isTracked}`);
        checkBox.setAttribute("tabindex", "-1");
        checkBox.classList.add('advisor-victory_tracker', 'size-7', 'mr-4');
        checkBox.addEventListener('action-activate', this.failsAtBottomTracker);
        titleContainer.appendChild(checkBox);

        const headerContainer = document.createElement("div");
        headerContainer.classList.add("header-container");
        headerContainer.style.display = "flex";
        headerContainer.style.flexDirection = "row";
        headerContainer.setAttribute("data-slot", "header");
        frame.appendChild(headerContainer);

        const description = document.createElement("div");
        description.classList.add("text-center", "mx-3\\.5", "font-body-sm");
        description.setAttribute("data-slot", "header");
        description.classList.add("text-center", "font-body-sm");
        description.style.marginLeft = "1.25rem";
        description.style.flexShrink = "1";
        description.style.minWidth = "0";
        description.innerHTML = this.isModern ? Locale.compose("LOC_TRADE_LENS_DESCRIPTION_ALT") : Locale.compose("LOC_TRADE_LENS_DESCRIPTION");
        headerContainer.appendChild(description);

        const sortOptions = [{ label: "LOC_TRADE_LENS_SORT_DEFAULT" }, { label: "LOC_TRADE_LENS_SORT_BY_LEADER" },
        { label: "LOC_TRADE_LENS_SORT_BY_RESOURCE" }, { label: "LOC_TRADE_LENS_SORT_BY_YIELD" }];
        this.sortOrder.classList.add("m-4", "font-body-lg");
        this.sortOrder.setAttribute("enable-shell-nav", "true");
        this.sortOrder.setAttribute("data-slot", "header");
        this.sortOrder.setAttribute("selected-item-index", "0");
        this.sortOrder.componentCreatedEvent.on((component) => component.updateSelectorItems(sortOptions));
        this.sortOrder.setAttribute("data-audio-focus-ref", "none");
        headerContainer.appendChild(this.sortOrder);

		this.setupResourceSelector(frame)
        this.setupUpdateSecondSorter()
        this.setupYieldSelector(frame)

        this.routesListEl.setAttribute("disable-focus-allowed", "true");
        frame.appendChild(this.routesListEl);
        if (this.isModern) {
            this.confirmButton = document.createElement("fxs-hero-button");
            this.confirmButton.classList.add("mx-7", "my-5");
            this.confirmButton.setAttribute("data-slot", "footer");
            this.confirmButton.setAttribute("caption", "LOC_TRADE_LENS_CONFIRM_ROUTE");
            this.confirmButton.setAttribute("disabled", "true");
            this.confirmButton.addEventListener("action-activate", () => this.checkAndStartTradeRoute());
            frame.appendChild(this.confirmButton);
        }

        this.updateInputDeviceType();
        this.Root.appendChild(fragment);
    }
    onInitialize() {
        this.applySort();
    }
    onAttach() {
        super.onAttach();
        this.Root.addEventListener('navigate-input', this.navigateInputListener);
        this.Root.addEventListener('engine-input', this.engineInputListener);
        window.addEventListener(ActiveDeviceTypeChangedEventName, this.activeDeviceTypeListener, true);
        TradeRouteChooser._activeChooser = this;
        Focus.setContextAwareFocus(this.routesListEl, this.Root);
    }
    onDetach() {
        super.onDetach();
        TradeRouteChooser._activeChooser = undefined;
        TradeRoutesModel.clearTradeRouteVfx();
        this.tradeRouteBanner?.remove();
        this.Root.removeEventListener('navigate-input', this.navigateInputListener);
        this.Root.removeEventListener('engine-input', this.engineInputListener);
        window.removeEventListener(ActiveDeviceTypeChangedEventName, this.activeDeviceTypeListener, true);
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
        // This is a really, really gross way to prevent the unit actions from stealing focus
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
    onEngineInput(inputEvent) {
        if (inputEvent.detail.status != InputActionStatuses.FINISH) {
            return;
        }
        if (inputEvent.detail.name == 'cancel' || inputEvent.detail.name == 'sys-menu') {
            ContextManager.pop("trade-route-chooser");
            ViewManager.handleReceiveFocus();
            inputEvent.stopPropagation();
            inputEvent.preventDefault();
        }
    }
    onNavigateInput(event) {
        if (event.detail.status != InputActionStatuses.FINISH) {
            return;
        }
        const direction = event.getDirection();
        if (direction == InputNavigationAction.SHELL_PREVIOUS) {
            this.sortOrder.component.selectPrevious();
            event.stopPropagation();
        }
        else if (direction == InputNavigationAction.SHELL_NEXT) {
            this.sortOrder.component.selectNext();
            event.stopPropagation();
        }
    }
    updateInputDeviceType() {
        if (this.confirmButton) {
            this.confirmButton.classList.toggle("hidden", ActionHandler.isGamepadActive);
        }
    }
    defaultSort(a, b) {
        if (!this.failsAtBottom) {
            const statusComparison = Number(b.route.status == TradeRouteStatus.SUCCESS) - Number(a.route.status == TradeRouteStatus.SUCCESS);
            if (statusComparison !== 0) {
                return statusComparison;
            }
        }
        return (b.route.importPayloads.length) - (a.route.importPayloads.length);
    }
    leaderSort(a, b) {
        if (!this.failsAtBottom) {
            const statusComparison = Number(b.route.status == TradeRouteStatus.SUCCESS) -
                Number(a.route.status == TradeRouteStatus.SUCCESS);
            if (statusComparison !== 0) {
                return statusComparison;
            }
        }
        return b.route.leaderName.localeCompare(a.route.leaderName);
    }

    resourceSort(a, b) {
        if (!this.failsAtBottom) {
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
        if (!this.failsAtBottom) {
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
            this.slthlogger('distant lands present!')
            this.slthlogger(distantLandsKey)
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
        if (!this.failsAtBottom) {
            const statusComparison = Number(b.route.status == TradeRouteStatus.SUCCESS) -
                Number(a.route.status == TradeRouteStatus.SUCCESS);
            if (statusComparison !== 0) {
                return statusComparison;
            }
        }
        let aYieldCount = a.route.yieldCountMap.get(this.yieldSortBy) || 0;
        let bYieldCount = b.route.yieldCountMap.get(this.yieldSortBy) || 0;
        this.slthlogger(`Yield amounts for ${Locale.compose(a.route.city.name)}: ${aYieldCount}, vs ${Locale.compose(b.route.city.name)} ${bYieldCount}`)
        const resourceComparison = bYieldCount - aYieldCount;

        if (resourceComparison === 0) {
            return (b.route.importPayloads.length) - (a.route.importPayloads.length);
        }
        return resourceComparison;
    }
    applySort() {
        if (this.sortMode == "LOC_TRADE_LENS_SORT_DEFAULT") {
            this.tradeRoutes.sort((a, b) => this.defaultSort(a, b));
        }
        else if (this.sortMode == "LOC_TRADE_LENS_SORT_BY_LEADER") {
            this.tradeRoutes.sort((a, b) => this.leaderSort(a, b));
        }
        else if (this.sortMode == "LOC_TRADE_LENS_SORT_BY_RESOURCE") {
            if (this.isModern) {
                this.tradeRoutes.sort((a, b) => this.modernResourceSort(a, b));
            }
            this.tradeRoutes.sort((a, b) => this.resourceSort(a, b));           // arrow notation because need this.
        }
        else if (this.sortMode == "LOC_TRADE_LENS_SORT_BY_YIELD") {
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
        routeEle.setAttribute('data-tooltip-anchor', "right");
        routeEle.setAttribute('data-tooltip-anchor-offset', "10");
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
        const playerColor = UI.Color.getPlayerColors(tradeRoute.city.owner)?.primaryColor ?? { r: 0, g: 0, b: 0, a: 1 };
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
            const payloadIcon = document.createElement("fxs-icon");
            payloadIcon.classList.add("size-10", "relative");
            payloadIcon.setAttribute("data-icon-id", payload.ResourceType);
            payloadIcon.setAttribute("data-icon-context", "RESOURCE");
            payloadInfo.appendChild(payloadIcon);
            const payloadType = document.createElement("fxs-icon");
            payloadType.classList.add("size-4", "absolute", "left-0", "bottom-0");
            payloadType.setAttribute("data-icon-id", payload.ResourceClassType);
            payloadType.setAttribute("data-icon-context", "RESOURCECLASS");
            payloadIcon.appendChild(payloadType);
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
        UI.sendAudioEvent(Audio.getSoundTag('data-audio-trade-route-activate', 'audio-trade-route-chooser'));
        Camera.lookAtPlot(tradeRoute.cityPlotIndex);
        if (this.selectedEl != routeEle) {
            if (this.selectedEl) {
                this.selectedEl.component.selected = false;
            }
            this.selectedEl = routeEle;
            this.selectedRoute = tradeRoute;
            const isValidRoute = tradeRoute.status == TradeRouteStatus.SUCCESS;
            const canStartRoute = isValidRoute && this.checkAndStartTradeRoute(true);
            this.confirmButton?.setAttribute("disabled", (!canStartRoute).toString());
            if (isValidRoute) {
                this.showTradeRoutePathAndBanner();
            }
        }
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
        if (!this.isModern) {
            return false;
        }
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
        const commandValid = Game.UnitCommands.canStart(selectedUnitID, UnitCommandTypes.MAKE_TRADE_ROUTE, actionParams, false).Success;
        if (commandValid && !checkOnly) {
            Game.UnitCommands.sendRequest(selectedUnitID, UnitCommandTypes.MAKE_TRADE_ROUTE, actionParams);
            this.close();
        }
        return commandValid;
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
          const valueA = resourceClassMap.get(a) || '';
          const valueB = resourceClassMap.get(b) || '';
          const valueComparison = valueA.localeCompare(valueB)
          this.slthlogger(`A: ${valueA}, B: ${valueB} using keys ${a} and ${b}`)
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
          this.slthlogger(resourceOptions[0].value)
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
        let cached_resource_class = resourceClassMap.get(resourceTypes[0])
        for (const resource of resourceTypes) {
            if (i === limiter || resourceClassMap.get(resource) !== cached_resource_class) {
                this.resourceSelector.appendChild(gridLine);
                gridLine = document.createElement("div");
                gridLine.classList.add("flex", "flex-row", "mx-4", "mb-4");
                i = 0;
                this.slthlogger('added grid');
            }
            cached_resource_class = resourceClassMap.get(resource)
            this.slthlogger(`resource class for ${resource} is ${cached_resource_class}`)
            const selectionElement = document.createElement("fxs-chooser-item");
            // selectionElement.setAttribute("selectable-when-disabled", "true");
            selectionElement.setAttribute("select-on-focus", "true");
            // selectionElement.setAttribute("select-on-activate", "true");
            selectionElement.setAttribute("show-frame-on-hover", "false");
            // selectionElement.setAttribute("data-tooltip-style", "trade-route");
            selectionElement.setAttribute('data-tooltip-anchor', "right");
            // selectionElement.setAttribute('data-tooltip-anchor-offset', "10");
            // selectionElement.setAttribute("data-trade-route-index", tradeRoute.index.toString());
            selectionElement.setAttribute("data-audio-group-ref", "audio-trade-route-chooser");
            selectionElement.setAttribute("data-icon-id", resource);
            selectionElement.setAttribute("select-on-activate", "true");
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
                resourceType.setAttribute("data-icon-id", cached_resource_class);
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

        // Create an ordered array from the set
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

    setupUpdateSecondSorter(){
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
            this.applySort();
        });
    }
    onTrackFailsActivate(event) {
        if (event.target instanceof HTMLElement) {
            const isCurrentlyTracked = event.target.getAttribute('selected');
            this.failsAtBottom = isCurrentlyTracked === 'true' ? true : false;
            this.slthlogger(`fails at bottom set to ${this.failsAtBottom}`)
            this.applySort();
        }
    }

    onSwitchResourceActivate(event) {
        this.slthlogger(`Trying to set resource of ${event.currentTarget.getAttribute('data-icon-id')}`)
        if (this.resourceSelectionComponent != event.currentTarget) {
            if (this.resourceSelectionComponent) {
                this.resourceSelectionComponent.component.selected = false;
                this.slthlogger('resource selection pre-existed')
            }
            this.slthlogger('resource selection changing')
            this.resourceSelectionComponent = event.currentTarget;
            if (event.target instanceof HTMLElement) {
                 this.resourceSortBy = event.currentTarget.getAttribute('data-icon-id');
                 this.slthlogger(`Tracked Resource set to ${this.resourceSortBy}`)
                 this.applySort();
            }
        }
    }
    onSwitchYieldActivate(event) {
        this.slthlogger(`Trying to set yield of ${event.currentTarget.getAttribute('data-icon-id')}`)
        if (this.yieldSelectionComponent != event.currentTarget) {
            if (this.yieldSelectionComponent) {
                this.yieldSelectionComponent.component.selected = false;
                this.slthlogger('yield selection pre-existed')
            }
            this.slthlogger('yield selection changing')
            this.yieldSelectionComponent = event.currentTarget;
            if (event.target instanceof HTMLElement) {
                this.yieldSortBy = event.currentTarget.getAttribute('data-icon-id');
                this.slthlogger(`Tracked Yield set to ${this.yieldSortBy}`)
                this.applySort();
            }
        }
    }


    slthlogger (input) {
    if (log_level === 'blackwatch_plaid') {
        console.error(input)
    }
}
}
Controls.define('trade-route-chooser', {
    createInstance: TradeRouteChooser,
    description: 'Select and get info on trade routes.',
    classNames: ['trade-route-chooser'],
    styles: ['fs://game/base-standard/ui/trade-route-chooser/trade-route-chooser.css'],
    tabIndex: -1
});

//# sourceMappingURL=file:///base-standard/ui/trade-route-chooser/trade-route-chooser.js.map
