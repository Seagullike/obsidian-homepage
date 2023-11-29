import { Keymap, Platform, Plugin, addIcon, Editor, MarkdownView, moment } from "obsidian";
import { DEFAULT, MOBILE, Homepage, Kind } from "./homepage";
import { hasRequiredPeriodicity } from "./periodic";
import { DEFAULT_SETTINGS, HomepageSettings, HomepageSettingTab } from "./settings";

declare const DEV: boolean;
if (DEV) import("./dev");

//const ICON: string = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" xml:space="preserve" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linecap:round;stroke-linejoin:round;stroke-miterlimit:1.5"><path d="M10.025 21H6v-7H3v-1.5L12 3l9 9.5V14h-3v7h-4v-7h-3.975v7Z" style="fill:none;stroke:currentColor;stroke-width:2px"/></svg>`
const ICON: string = `<svg t="1689924859978" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="1808" width="95" height="95">
<path d="M504.3 103.4l442.9 314.2v507H78.8V416.8l425.5-313.4m-0.1-69.8c-10.2 0-20.4 3.2-29 9.6L13 383.6v554.2c0 29.1 23.6 52.6 52.6 52.6h894.7c29.1 0 52.6-23.6 52.6-52.6V383.6L532.5 42.7c-8.6-6.1-18.5-9.1-28.3-9.1z" p-id="1809" fill="currentColor"></path>
<path d="M512.9 754.6c-3.7 0-7.4-0.1-11.1-0.2-145.4-6.2-241.4-133-245.5-138.4-13-17.5-9.4-42.2 8.1-55.3 17.5-13 42.1-9.4 55.2 8 1.1 1.4 78.6 102.5 186.1 106.7 67.4 3 136.2-34.1 202.7-109.2 14.4-16.3 39.4-17.9 55.7-3.4 16.3 14.4 17.8 39.4 3.4 55.7-79.9 90.4-165.5 136.1-254.6 136.1z" p-id="1810" fill="currentColor"></path>
</svg>`;
export default class HomepagePlugin extends Plugin {
    settings: HomepageSettings;
    internalPlugins: Record<string, any>;
    communityPlugins: Record<string, any>;

    loaded: boolean = false;
    executing: boolean = false;

    homepage: Homepage;

    lastView: WeakRef<MarkdownView>;
    lastActiveTime: number;
    waitTime: number;		//5 * 60 * 1000; // 5分钟，单位为毫秒
    //editor: NonNullable<Editor>;

    async onload(): Promise<void> {
        const appStartup = document.body.querySelector(".progress-bar") !== null;

        this.settings = await this.loadSettings();
        this.internalPlugins = this.app.internalPlugins.plugins;
        this.communityPlugins = this.app.plugins.plugins;
        this.homepage = this.getHomepage();

        this.app.workspace.onLayoutReady(async () => {
            const ntp = this.communityPlugins["new-tab-default-page"];
            const openInitially = (
                this.homepage.data.openOnStartup &&
                appStartup && !this.hasUrlParams()
            );

            if (ntp) {
                ntp._checkForNewTab = ntp.checkForNewTab;
                ntp.checkForNewTab = async (e: any) => {
                    if (this && this.executing) { return; }
                    return await ntp._checkForNewTab(e);
                };
            }

            if (openInitially) await this.homepage.open();
            this.loaded = true;
        });

        addIcon("homepage", ICON);
        this.addRibbonIcon(
            "homepage",
            "Open homepage",
            e => this.homepage.open(
                e.button == 1 || e.button == 2 || Keymap.isModifier(e, "Mod")
                //right click, middle click, or ctrl/cmd
            )
        )
            .setAttribute("id", "nv-homepage-icon");

        this.registerEvent(this.app.workspace.on("layout-change", this.onLayoutChange));
        this.addSettingTab(new HomepageSettingTab(this.app, this));

        this.addCommand({
            id: "open-homepage",
            name: "Open homepage",
            callback: () => this.homepage.open(),
        });

        this.app.workspace.on("active-leaf-change", () => {
            // 更新lastActiveTime的值为当前时间
            this.lastActiveTime = Date.now();
        });

        this.app.workspace.on("editor-change", () => {
            // 更新lastActiveTime的值为当前时间
            this.lastActiveTime = Date.now();
        });

        this.checkInterval();

        console.log(
            `Homepage: ${this.homepage.data.value} ` +
            `(method: ${this.homepage.data.openMode}, view: ${this.homepage.data.view}, ` +
            `kind: ${this.homepage.data.kind})`
        );
    }

    async onunload(): Promise<void> {
        this.app.workspace.off("layout-change", this.onLayoutChange)

        const ntp = this.communityPlugins["new-tab-default-page"];
        if (!ntp) return;
        ntp.checkForNewTab = ntp._checkForNewTab;
    }

    onLayoutChange = async (): Promise<void> => {
        if (this.homepage.data.revertView) await this.homepage.revertView();
        if (this.homepage.data.openWhenEmpty) await this.homepage.openWhenEmpty();
        if (this.homepage.data.alwaysApply) await this.homepage.apply();
    }

    getHomepage(): Homepage {
        if (this.settings.separateMobile && Platform.isMobile) {
            if (!(MOBILE in this.settings.homepages)) {
                this.settings.homepages[MOBILE] = { ...this.settings.homepages[DEFAULT] };
            }

            return new Homepage(MOBILE, this);
        }
        return new Homepage(DEFAULT, this);
    }

    async loadSettings(): Promise<HomepageSettings> {
        const settingsData = await this.loadData();

        if (!settingsData || settingsData.version !== 2) {
            return Object.assign({}, DEFAULT_SETTINGS, settingsData);
        }
        else {
            //Upgrade settings from v2.x
            const settings: HomepageSettings = {
                version: 3,
                homepages: {},
                separateMobile: false,
                intervalTime: 5,
            }

            const data = settingsData;

            if (settingsData.workspaceEnabled) {
                data.value = data.workspace;
                data.kind = Kind.Workspace;
            }
            else if (settingsData.useMoment) {
                data.value = data.momentFormat;
                data.kind = Kind.MomentDate;
            }
            else {
                data.value = data.defaultNote;
                data.kind = Kind.File;
            }

            data.commands = [];

            delete data.workspace;
            delete data.momentFormat;
            delete data.defaultNote;
            delete data.useMoment;
            delete data.workspaceEnabled;
            settings.homepages[DEFAULT] = data;

            return settings;
        }
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    hasUrlParams(): boolean {
        const params = window.OBS_ACT;

        return (
            params && ["open", "advanced-uri"].includes(params?.action) &&
            ("file" in params || "filepath" in params || "workspace" in params)
        )
    }

    hasRequiredPlugin(kind: Kind): boolean {
        switch (kind) {
            case Kind.Workspace:
                return this.internalPlugins["workspaces"]?.enabled;
            case Kind.Graph:
                return this.internalPlugins["graph"]?.enabled;
            case Kind.DailyNote:
            case Kind.WeeklyNote:
            case Kind.MonthlyNote:
            case Kind.YearlyNote:
                return hasRequiredPeriodicity(kind, this);
            default:
                return true;
        }
    }

    /**
   * Gets the current markdown editor if it exists {@link https://github.com/chrisgrieser/obsidian-smarter-paste/blob/master/main.ts#L37-L41|Obsidian Smarter Paste Source}
   * @return {Editor} Returns the current codemirror editor if there is an active view of type markdown or null if there is not one.
   */
    private getEditor(): Editor | null {
        const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeLeaf) return null;
        return activeLeaf.editor;
    }

    private checkInterval() {
        this.waitTime = this.settings.intervalTime * 60 * 1000;
        if (this.waitTime === undefined || this.waitTime === 0) {
            return;
        }

        this.lastActiveTime = Date.now();
        setInterval(async () => {
            this.waitTime = this.settings.intervalTime * 60 * 1000;
            if (this.waitTime === undefined || this.waitTime === 0) {
                return;
            }

            const currentTime = Date.now();
            const timeSinceLastActive = currentTime - this.lastActiveTime;
            if (timeSinceLastActive > this.waitTime) {
                const home = this.getHomepage();
                await home.open();
            }
        }, this.waitTime);
    }
}
