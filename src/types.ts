import "obsidian";

declare module "obsidian" {
	interface App {
		commands: CommandRegistry;
		plugins: PluginRegistry;
		internalPlugins: PluginRegistry;
		setting: any;
	}
	
	interface CommandRegistry {
		findCommand: (id: string) => Command;
		executeCommandById: (id: string) => void;
		commands: Record<string, Command>;
	}
	
	interface PluginRegistry {
		manifests: Record<string, PluginManifest>;
		plugins: Record<string, any>;
		enablePluginAndSave: (id: string) => Promise<void>;
		loadPlugin: (id: string) => Promise<void>;
		disablePlugin: (id: string) => Promise<void>;
		disablePluginAndSave: (id: string) => Promise<void>;
		installPlugin: (repo: string, version: string, manifest: PluginManifest) => Promise<void>;
	}
	
	interface Vault {
		config: Record<string, any>;
	}
	
	interface WorkspaceLeaf {
		parentSplit: WorkspaceSplit;
	}
	
	interface WorkspaceRibbon {
		items: WorkspaceRibbonItem[];
		onChange: (a: boolean) => void;
	}
	
	interface WorkspaceRibbonItem {
		id: string;
		hidden: boolean;
	}
	
	interface WorkspaceSplit {
		children: any[];
	}
}

declare global {
	interface Window {
		OBS_ACT: string | any;
		electron: any;
		electronWindow: any;
		homepageLegacyOptionsEnabled: boolean;
		homepageLoadDebugInfo: (info: any) => Promise<void>;
		homepageEnsurePlugins: (plugins: string[], enable: boolean) => Promise<void>;
	}
}
