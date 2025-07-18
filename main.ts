import { Plugin, Notice, PluginSettingTab, App, Setting, TFile  } from 'obsidian';

//----------------------------------------------------------------------------------------------------//
//----- Settings -----//
interface propertyBaronSettings {
    propertyList: string;
    noPrefixProperties: string;
    propertyListMode: 'Whitelist' | 'Blacklist';
}

const DEFAULT_SETTINGS: propertyBaronSettings = {
    propertyList: '',
    noPrefixProperties: '',
    propertyListMode: 'Whitelist'
};

class propertyBaronSettingsTab extends PluginSettingTab {
    plugin: propertyBaron;

    constructor(app: App, plugin: propertyBaron) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        
        //----- Fill Tags with Properties Settings -----//
        containerEl.createEl('h1', { text: 'Fill Tags with Properties' });
        
        new Setting(containerEl)
            .setName('Property List Mode')
            .setDesc('Choose whether the property list acts as a blacklist (exclude) or whitelist (only include)')
            .addDropdown(drop => drop
                .addOption('Whitelist', 'Whitelist (only include these properties)')
                .addOption('Blacklist', 'Blacklist (exclude these properties)')
                .setValue(this.plugin.settings.propertyListMode)
                .onChange(async (value: 'Whitelist' | 'Blacklist') => {
                    this.plugin.settings.propertyListMode = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Property List')
            .setDesc('Comma-separated list of properties')
            .addText(text => text
                .setPlaceholder('')
                .setValue(this.plugin.settings.propertyList)
                .onChange(async (value) => {
                    this.plugin.settings.propertyList = value;
                    await this.plugin.saveSettings();
                })
        );
        
        new Setting(containerEl)
            .setName('No Prefix Properties')
            .setDesc('Comma-separated list of properties to add as tags without the PropertyName/ prefix. Be aware that certain tags will still have prefixes in order to make them valid tags. These mostly include "numbers only" tags.')
            .addText(text => text
                .setPlaceholder('')
                .setValue(this.plugin.settings.noPrefixProperties)
                .onChange(async (value) => {
                    this.plugin.settings.noPrefixProperties = value;
                    await this.plugin.saveSettings();
                })
        );
    }
}

// ----------------------------------------------------------------------------------------------------//
//----- Main Plugin Class -----//
export default class propertyBaron extends Plugin {
    settings: propertyBaronSettings;

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new propertyBaronSettingsTab(this.app, this));

        //----- Add Commands -----//
        this.addCommand({
            id: 'fill-tags-with-properties',
            name: 'Fill Tags with Properties on Current File',
            callback: () => {
                const file = this.app.workspace.getActiveFile()
                if (file) {
                    this.fillTagsWithProperties(file);
                }
            }
            
        });

        this.addCommand({
            id: 'fill-tags-with-properties-all-files',
            name: 'Fill Tags with Properties All Files on All Files',
            callback: () => {
                this.fillTagsWithPropertiesAllFiles(this.app);
            }            
        });

        this.addCommand({
            id: 'clear-all-tags',
            name: 'Clear All Tags on Current File',
            callback: () => {
                const file = this.app.workspace.getActiveFile()
                if (file) {
                    this.clearAllTags(file);
                }
            } 
        });

        this.addCommand({
            id: 'clear-all-tags-all-files',
            name: 'Clear All Tags All Files on All Files',
            callback: () => {
                this.clearAllTagsAllFiles(this.app);
            }            
        });
    }

    //----------------------------------------------------------------------------------------------------//
    //----- Functions -----//

    //----- Load Settings -----//
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    //----- Save Settings -----//
    async saveSettings() {
        await this.saveData(this.settings);
    }

    //----- Clear All Tags -----//
    async clearAllTags(file: TFile) {
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
            const tagsKey = Object.keys(frontmatter).find(k => k.toLowerCase() === 'tags');
            
            if (tagsKey) {
                frontmatter[tagsKey] = [];
            } else {
                frontmatter['tags'] = [];
            }
        });
    }

    //----- Clear All Tags All Files -----//
    async clearAllTagsAllFiles(app: App) {
        new Notice('Starting to clear all tags across your vault')
        await Promise.all(app.vault.getMarkdownFiles().map(async (file) => {
            try {
                await this.clearAllTags(file);
            } catch (error) {
                new Notice(error);
            }
        }));
        new Notice("Job's Done")
    }

    //----- Fill Tags With Properties -----//
    async fillTagsWithProperties(file: TFile) {
        //----- Load Settings -----//
        const propertyListMode = this.settings.propertyListMode;
        const propertyList = this.settings.propertyList
            .split(',')
            .map(p => p.trim().toLowerCase())
            .filter(Boolean);
        
        switch (propertyListMode) {
            case 'Blacklist': {
                if (!propertyList.includes('tags')) {
                    propertyList.push('tags');
                }
            }
            break;
            case 'Whitelist': {
                const tagsIndex = propertyList.indexOf('tags');
                if (tagsIndex !== -1) {
                    propertyList.splice(tagsIndex, 1);
                }
            }
            break;
        }

        const noPrefixProperties = this.settings.noPrefixProperties
            .split(',')
            .map(p => p.trim().toLowerCase())
            .filter(Boolean);
        
        //----- Process Frontmatter -----//
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
            const tagsKey = Object.keys(frontmatter).find(k => k.toLowerCase() === 'tags');
            const currentTags = tagsKey ? frontmatter[tagsKey] : [];

            let filteredProperties: string[];
            switch (propertyListMode) {
                case 'Blacklist': {
                    filteredProperties = Object.keys(frontmatter)
                        .filter(key => !propertyList.includes(key.toLowerCase()));
                }
                break;
                case 'Whitelist': {
                    filteredProperties = Object.keys(frontmatter)
                        .filter(key => propertyList.includes(key.toLowerCase()));
                }
                break;
            }

            const newTags =[];
            
            for (const property of filteredProperties) {
                const value = frontmatter[property];
                const isNoPrefix = noPrefixProperties.includes(property.toLowerCase());
                
                if (value != null) {
                    switch (typeof value) {
                        case 'object': {
                            for (const eachValue of value) {
                                let cleanedValue = eachValue;

                                const wikiMatch = /^\[\[[^\|\]]+\|([^\]]+)\]\]$/.exec(cleanedValue);
                                if (wikiMatch) {
                                    cleanedValue = wikiMatch[1];
                                }
                                cleanedValue = cleanedValue.replace(/\s+/g, "_");
                                cleanedValue = cleanedValue.replace(/[^a-zA-Z0-9_-]/g, "");

                                if (/[a-zA-Z_-]/.test(cleanedValue)) {
                                    newTags.push(isNoPrefix ? cleanedValue : `${property}/${cleanedValue}`);
                                } else {
                                    newTags.push(`${property}/${cleanedValue}`);
                                }
                            }
                            break;
                        }
                        case 'string': {
                            let cleanedValue = value;

                            const wikiMatch = /^\[\[[^\|\]]+\|([^\]]+)\]\]$/.exec(cleanedValue);
                            if (wikiMatch) {
                                cleanedValue = wikiMatch[1];
                            }
                            cleanedValue = cleanedValue.replace(/\s+/g, "_");
                            cleanedValue = cleanedValue.replace(/[^a-zA-Z0-9_-]/g, "");

                            if (/[a-zA-Z_-]/.test(cleanedValue)) {
                                newTags.push(isNoPrefix ? cleanedValue : `${property}/${cleanedValue}`);
                            } else {
                                newTags.push(`${property}/${cleanedValue}`);
                            }
                            break;
                        }
                        case 'number': {
                            let cleanedValue = String(value).replace(/\./g, "_");
                            newTags.push(`${property}/${cleanedValue}`);
                            break;
                        }
                        case 'boolean': {
                            newTags.push(isNoPrefix ? value : `${property}/${value}`);
                            break;
                        }
                    }
                }
            }

            const mergedTags = Array.from(new Set([
                ...(Array.isArray(currentTags) ? currentTags : []),
                ...(Array.isArray(newTags) ? newTags : [])
            ]));

            if (tagsKey) {
                frontmatter[tagsKey] = mergedTags;
            } else {
                frontmatter['tags'] = mergedTags;
            }
        });
    }

    //----- Fill Tags with Properties All Files -----//
    async fillTagsWithPropertiesAllFiles(app: App) {
        new Notice('Starting to fill tags with properties across your vault')
        await Promise.all(app.vault.getMarkdownFiles().map(async (file) => {
            try {
                await this.fillTagsWithProperties(file);
            } catch (error) {
                new Notice(error);
            }
        }));
        new Notice("Job's Done")
    }
}