import { App, FileView, MarkdownView, Notice, View as OView, WorkspaceLeaf, moment } from "obsidian";
import HomepagePlugin from "./main";
import { getAutorun, getPeriodicNote } from "./periodic";
import { emptyActiveView, equalsCaseless, randomFile, trimFile, untrimName } from "./utils";

export const LEAF_TYPES: string[] = ["markdown", "canvas", "kanban"];

export const DEFAULT: string = "Main Homepage";
export const MOBILE: string = "Mobile Homepage";

export interface HomepageData {
    [member: string]: any,
    value: string,
    kind: string,
    openOnStartup: boolean,
    openMode: string,
    manualOpenMode: string,
    view: string,
    revertView: boolean,
    openWhenEmpty: boolean,
    refreshDataview: boolean,
    autoCreate: boolean,
    autoScroll: boolean,
    pin: boolean,
    commands: string[],
    alwaysApply: boolean,
    hideReleaseNotes: boolean
}

export enum Mode {
    ReplaceAll = "Replace all open notes",
    ReplaceLast = "Replace last note",
    Retain = "Keep open notes"
}

export enum View {
    Default = "Default view",
    Reading = "Reading view",
    Source = "Editing view (Source)",
    LivePreview = "Editing view (Live Preview)"
}

export enum Kind {
    File = "File",
    Workspace = "Workspace",
    Random = "Random file",
    Graph = "Graph view",
    None = "Nothing",
    DailyNote = "Daily Note",
    WeeklyNote = "Weekly Note",
    MonthlyNote = "Monthly Note",
    YearlyNote = "Yearly Note",

    /** @deprecated will be removed in 4.0 */
    MomentDate = "Date-dependent file"
}

export class Homepage {
    plugin: HomepagePlugin;
    app: App;
    data: HomepageData;

    name: string;
    lastView?: WeakRef<MarkdownView> = undefined;
    openedViews: WeakMap<FileView, string> = new WeakMap();
    computedValue: string;

    constructor(name: string, plugin: HomepagePlugin) {
        this.name = name;
        this.plugin = plugin;
        this.app = plugin.app;
        this.data = plugin.settings.homepages[name];

        if (!this.data.commands) {
            this.data.commands = [];
            this.save();
        }

        if (this.data?.hasRibbonIcon == false) {
            this.app.workspace.onLayoutReady(async () => {
                const ribbon = this.app.workspace.leftRibbon;
                ribbon.items.find(i => i.id === "homepage:Open homepage")!.hidden = true;
                ribbon.onChange(true);

                delete this.data.hasRibbonIcon;
                this.save();
            });
        }
    }

    async open(alternate: boolean = false): Promise<void> {
        if (!this.plugin.hasRequiredPlugin(this.data.kind as Kind)) {
            new Notice("Homepage cannot be opened due to plugin unavailablity.");
            return;
        }
        else if (this.data.hideReleaseNotes) {
            this.app.workspace.detachLeavesOfType("release-notes");
        }

        if (this.data.kind === Kind.Workspace) {
            await this.launchWorkspace();
        }
        else if (this.data.kind !== Kind.None) {
            let mode = this.plugin.loaded ? this.data.manualOpenMode : this.data.openMode;
            if (alternate) mode = Mode.Retain;

            await this.launchLeaf(mode as Mode);
        }

        if (!this.data.commands) return;

        this.writeDownMoment();

        for (const command of this.data.commands) {
            this.app.commands.executeCommandById(command);
        }
    }

    async launchWorkspace() {
        const workspacePlugin = this.plugin.internalPlugins.workspaces?.instance;

        if (!(this.data.value in workspacePlugin.workspaces)) {
            new Notice(`Cannot find the workspace "${this.data.value}" to use as the homepage.`);
            return;
        }

        workspacePlugin.loadWorkspace(this.data.value);
    }

    async launchLeaf(mode: Mode) {
        let leaf: WorkspaceLeaf | undefined;

        this.computedValue = await this.computeValue();
        this.plugin.executing = true;

        if (getAutorun(this.plugin) && !this.plugin.loaded) {
            return;
        }

        if (mode !== Mode.ReplaceAll) {
            const alreadyOpened = this.getOpened();

            if (alreadyOpened.length > 0) {
                this.app.workspace.setActiveLeaf(alreadyOpened[0]);
                await this.configure(alreadyOpened[0]);
                return;
            }
            else if (mode == Mode.Retain && emptyActiveView(this.app)) {
                //if there is an empty tab, don't keep it
                mode = Mode.ReplaceLast;
            }
        }

        if (mode !== Mode.Retain) {
            this.app.workspace.getActiveViewOfType(OView)?.leaf.setPinned(false);
        }
        if (mode === Mode.ReplaceAll) {
            LEAF_TYPES.forEach(t => this.app.workspace.detachLeavesOfType(t));
            await Promise.resolve(); //let obsidian initialise the new empty leaf
        }

        if (this.data.kind === Kind.Graph) leaf = await this.launchGraph(mode);
        else leaf = await this.launchNote(mode);
        if (!leaf) return;

        await this.configure(leaf);
    }

    async launchGraph(mode: Mode): Promise<WorkspaceLeaf | undefined> {
        if (mode === Mode.Retain) {
            const leaf = this.app.workspace.getLeaf("tab");
            this.app.workspace.setActiveLeaf(leaf);
        }

        this.app.commands.executeCommandById("graph:open");
        return this.app.workspace.getActiveViewOfType(OView)?.leaf;
    }

    async launchNote(mode: Mode): Promise<WorkspaceLeaf | undefined> {
        let file = this.app.metadataCache.getFirstLinkpathDest(this.computedValue, "/");

        if (!file) {
            if (!this.data.autoCreate) {
                new Notice(`Homepage "${this.computedValue}" does not exist.`);
                return undefined;
            }

            file = await this.app.vault.create(untrimName(this.computedValue), "");
        }

        const leaf = this.app.workspace.getLeaf(mode == Mode.Retain);
        await leaf.openFile(file);
        this.app.workspace.setActiveLeaf(leaf);

        return leaf;
    }

    async configure(leaf: WorkspaceLeaf): Promise<void> {
        this.plugin.executing = false;
        const view = leaf.view;

        if (!(view instanceof MarkdownView)) {
            if (this.data.pin) view.leaf.setPinned(true);
            return;
        }

        const state = view.getState();

        if (this.data.revertView) {
            this.lastView = new WeakRef(view);
        }

        if (this.data.autoScroll) {
            const count = view.editor.lineCount();

            if (state.mode == "preview") {
                view.previewMode.applyScroll(count - 4);
            }
            else {
                view.editor.setCursor(count);
                view.editor.focus();
            }
        }

        if (this.data.pin) view.leaf.setPinned(true);
        if (this.data.view == View.Default) return;

        switch (this.data.view) {
            case View.LivePreview:
            case View.Source:
                state.mode = "source";
                state.source = this.data.view != View.LivePreview;
                break;
            case View.Reading:
                state.mode = "preview";
                break;
        }

        await view.leaf.setViewState({ type: "markdown", state: state });

        if (this.plugin.loaded && this.data.refreshDataview) {
            this.plugin.communityPlugins.dataview?.index.touch();
        }
    }

    getOpened(): WorkspaceLeaf[] {
        if (this.data.kind == Kind.Graph) return this.app.workspace.getLeavesOfType("graph");

        const leaves = LEAF_TYPES.flatMap(i => this.app.workspace.getLeavesOfType(i));
        return leaves.filter(
            leaf => trimFile((leaf.view as FileView).file!) == this.computedValue
        );
    }

    async computeValue(): Promise<string> {
        let val = this.data.value;

        switch (this.data.kind) {
            case Kind.MomentDate:
                val = moment().format(this.data.value);
                break;
            case Kind.Random:
                const file = randomFile(this.app);
                if (file) val = file;
                break;
            case Kind.DailyNote:
            case Kind.WeeklyNote:
            case Kind.MonthlyNote:
            case Kind.YearlyNote:
                val = await getPeriodicNote(this.data.kind, this.plugin);
                break;
        }

        return val
    }

    async save(): Promise<void> {
        this.plugin.settings.homepages[this.name] = this.data;
        await this.plugin.saveSettings();
    }

    async revertView(): Promise<void> {
        if (this.lastView == undefined || this.data.view == View.Default) return;

        const view = this.lastView.deref();
        if (!view || equalsCaseless(trimFile(view.file!), this.computedValue)) return;

        const state = view.getState(),
            config = this.app.vault.config,
            mode = config.defaultViewMode || "source",
            source = config.livePreview !== undefined ? !config.livePreview : false;

        if (
            view.leaf.getViewState().type == "markdown" &&
            (mode != state.mode || source != state.source)
        ) {
            state.mode = mode;
            state.source = source;
            await view.leaf.setViewState({ type: "markdown", state: state, active: true });
        }

        this.lastView = undefined;
    }

    async openWhenEmpty(): Promise<void> {
        if (!this.plugin.loaded || this.plugin.executing) return;
        const leaf = this.app.workspace.getActiveViewOfType(OView)?.leaf;

        if (
            leaf?.getViewState().type !== "empty" ||
            leaf.parentSplit.children.length != 1
        ) return

        //should always behave the same regardless of mode
        await this.open(true);
    }

    async apply(): Promise<void> {
        const currentView = this.app.workspace.getActiveViewOfType(FileView);
        if (!currentView) return;

        const currentValue = trimFile(currentView.file!);
        if (this.openedViews.get(currentView) === currentValue) return;

        this.openedViews.set(currentView, currentValue);

        if (
            currentValue === await this.computeValue() &&
            this.plugin.loaded && !this.plugin.executing
        ) {
            await this.configure(currentView.leaf);
        }
    }

    private writeDownMoment() {
        const editor = this.app.workspace.activeEditor;
        if (!editor) {
            return;
        }
        var editorValue = editor.editor?.getValue();
        if (!editorValue) {
            return;
        }
        // 待办事项
        var keepedTodos = this.keepTodo(editorValue);
        var clearedText = this.clearTodo(editorValue);

        if (keepedTodos.length > 0) {
            for (let i = 0; i < keepedTodos.length; i++) {
                clearedText = `${clearedText}\n\n${keepedTodos[i]}`;
            }
        }

        // 时间戳
        var keepedMoments = this.keepMoment(clearedText);
        clearedText = this.clearMoment(clearedText);
        if (keepedMoments.length > 0) {
            for (let i = 0; i < keepedMoments.length; i++) {
                clearedText = `${clearedText}\n\n${keepedMoments[i]}`;
            }
        }
        const time = moment().format('YYYY-MM-DD HH:mm:ss');
        clearedText = `${clearedText}\n\n${time}`;
        editor.editor?.setValue(clearedText);
    }

    private clearMoment(content: string) {
        const text = content;
        const regex = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g;
        const matches = text.match(regex);

        if (matches) {
            let newText = text;
            for (let i = 0; i < matches.length; i++) {
                newText = newText.replace(matches[i], '').trim();
            }
            const cleanedText = newText.replace(/\n{2,}/g, "\n\n");
            return cleanedText
        }
        return text.replace(/\n{2,}/g, "\n\n");
    }

    private keepMoment(content: string) {
        const text = content;
        const regex = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g;
        const matches = text.match(regex);

        const keepMoments = [];
        if (matches) {
            const lastIndexToKeep = Math.max(matches.length - 4, 0);
            for (let i = lastIndexToKeep; i < matches.length; i++) {
                keepMoments.push(matches[i]);
            }
        }
        return keepMoments;
    }

    private keepTodo(content: string) {
        // 正则表达式
        const regexPatternBug = /### (.*?)?Bug\s*\n\n\s*[\s\S]*?(?=\n\n|$)/g;
        const regexPatternTodo = /### (.*?)?Todo\s*\n\n\s*[\s\S]*?(?=\n\n|$)/g;
        const todos: string[] = [];

        // Bug Todo
        const matchesBug = content.match(regexPatternBug);
        if (matchesBug) {
            for (let i = 0; i < matchesBug.length; i++) {
                todos.push(matchesBug[i]);
            }
        }
        const matchesTodo = content.match(regexPatternTodo);
        if (matchesTodo) {
            for (let i = 0; i < matchesTodo.length; i++) {
                todos.push(matchesTodo[i]);
            }
        }

        return todos;
    }

    private clearTodo(content: string) {
        // 正则表达式模式
        const regexPatternBug = /### (.*?)?Bug\s*\n\n\s*[\s\S]*?(?=\n\n|$)/g;
        const regexPatternTodo = /### (.*?)?Todo\s*\n\n\s*[\s\S]*?(?=\n\n|$)/g;
        // 使用正则表达式匹配待办事项
        const matchesBug = content.match(regexPatternBug);
        if (matchesBug) {
            let newText = content;
            for (let i = 0; i < matchesBug.length; i++) {
                newText = newText.replace(matchesBug[i], '').trim();
            }
            const cleanedText = newText.replace(/\n{2,}/g, "\n\n");
            content = cleanedText;
        }
        const matchesTodo = content.match(regexPatternTodo);
        if (matchesTodo) {
            let newText = content;
            for (let i = 0; i < matchesTodo.length; i++) {
                newText = newText.replace(matchesTodo[i], '').trim();
            }
            const cleanedText = newText.replace(/\n{2,}/g, "\n\n");
            content = cleanedText;
        }

        return content.replace(/\n{2,}/g, "\n\n");
    }
}
