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
class TradeRouteChooser extends Panel {
    static get activeChooser() {
        return this._activeChooser;
    }
    constructor(root) {
        super(root);
        this.isModern = Game.age == Database.makeHash("AGE_MODERN");
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
        const title = document.createElement("fxs-header");
        title.setAttribute("data-slot", "header");
        title.setAttribute("title", this.isModern ? "LOC_TRADE_LENS_TITLE_ALT" : "LOC_TRADE_LENS_TITLE");
        frame.appendChild(title);
        const description = document.createElement("div");
        description.classList.add("text-center", "mx-3\\.5", "font-body-sm");
        description.setAttribute("data-slot", "header");
        description.innerHTML = this.isModern ? Locale.compose("LOC_TRADE_LENS_DESCRIPTION_ALT") : Locale.compose("LOC_TRADE_LENS_DESCRIPTION");
        frame.appendChild(description);
        const sortOptions = [{ label: "LOC_TRADE_LENS_SORT_DEFAULT" }, { label: "LOC_TRADE_LENS_SORT_BY_LEADER" }];
        this.sortOrder.classList.add("m-4", "font-body-lg");
        this.sortOrder.setAttribute("enable-shell-nav", "true");
        this.sortOrder.setAttribute("data-slot", "header");
        this.sortOrder.setAttribute("selected-item-index", "0");
        this.sortOrder.componentCreatedEvent.on((component) => component.updateSelectorItems(sortOptions));
        this.sortOrder.addEventListener("dropdown-selection-change", (ev) => {
            this.sortMode = ev.detail.selectedItem?.label ?? "LOC_TRADE_LENS_SORT_DEFAULT";
            this.applySort();
        });
        this.sortOrder.setAttribute("data-audio-focus-ref", "none");
        frame.appendChild(this.sortOrder);
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
        return (Number(b.route.status == TradeRouteStatus.SUCCESS) - Number(a.route.status == TradeRouteStatus.SUCCESS))
            || (b.route.importPayloads.length) - (a.route.importPayloads.length);
    }
    leaderSort(a, b) {
        return (Number(b.route.status == TradeRouteStatus.SUCCESS) - Number(a.route.status == TradeRouteStatus.SUCCESS))
            || b.route.leaderName.localeCompare(a.route.leaderName);
    }
    applySort() {
        if (this.sortMode == "LOC_TRADE_LENS_SORT_DEFAULT") {
            this.tradeRoutes.sort(this.defaultSort);
        }
        else if (this.sortMode == "LOC_TRADE_LENS_SORT_BY_LEADER") {
            this.tradeRoutes.sort(this.leaderSort);
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
}
Controls.define('trade-route-chooser', {
    createInstance: TradeRouteChooser,
    description: 'Select and get info on trade routes.',
    classNames: ['trade-route-chooser'],
    styles: ['fs://game/base-standard/ui/trade-route-chooser/trade-route-chooser.css'],
    tabIndex: -1
});

//# sourceMappingURL=file:///base-standard/ui/trade-route-chooser/trade-route-chooser.js.map
