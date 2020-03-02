import { promises } from 'fs';
import { join } from 'path';
import { Message, Collection } from 'discord.js';
import { red, green } from 'chalk';

import EventListener from './eventListener';
import CommandListener from './commandListener';
import { HandlerOptions, RunCallbacks, GenericUtils } from '../interfaces/main';
import { GenericEvent } from '../interfaces/events';

const { lstat, readdir } = promises;

// Define Handler class

export default class Handler {
  // Define its properties
  private readonly client: HandlerOptions['client'];

  private readonly token?: HandlerOptions['token'];
  private readonly verbose?: HandlerOptions['verbose'];

  private readonly eventsFolder?: HandlerOptions['eventsFolder'];
  private readonly commandsFolder?: HandlerOptions['commandsFolder'];

  // Representation of all the available commands
  private readonly commands: Collection<CommandListener['aliases'], CommandListener['listener']> = new Collection();

  constructor({ client, token, verbose, eventsFolder, commandsFolder }: HandlerOptions) {
    this.client = client;
    this.token = token;
    this.verbose = verbose;
    this.eventsFolder = eventsFolder;
    this.commandsFolder = commandsFolder;
  }

  /*
   * Login with the provided token using the library
   */
  readonly login = async (): Promise<void> => {
    try {
      await this.client.login(this.token);
    } catch (e) {
      throw red('Invalid token or Discord API down');
    }
  };

  /*
   * Scans folders and their types and does actions with them
   * @param path Full path of the folder that is going to be read
   * @param type Type of the scan we are doing, can be both events or commands
   */
  private readonly scanFolder = async (path: string, type: 'events' | 'commands'): Promise<void> => {
    try {
      // Checks if given path is a file
      if (!(await lstat(path)).isDirectory()) throw red(`The path ${path} is a file. It must be a directory`);

      // Reads the files inside the directory and loops around each one
      const files = await readdir(path);
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const newFullPath = join(path, file);

        // If the child is a file, proceed with action. Else, run this same function again, which allows recursive and categorized commands and events
        if ((await lstat(newFullPath)).isDirectory()) return await this.scanFolder(newFullPath, type);

        // Ignore the file if it is not a JavaScript or TypeScript file
        if (!file.endsWith('.js') && !file.endsWith('.ts')) return;

        const fileContent = await import(newFullPath);
        const ListenerClass = fileContent.default || fileContent;

        // Ignore the file if we cannot find a valid class (CommandListener or EventListener)
        if (!ListenerClass) return;

        const importedListener: EventListener | CommandListener = new ListenerClass();
        const { listener } = importedListener;

        if (type === 'events') {
          const { event } = importedListener as EventListener;

          // If we are searching for events, treat the export as an event, get its properties and make the client listen for them, with the correct callback
          const callback: GenericEvent['listener'] = listener.bind(importedListener, { client: this.client, handler: this });

          this.client.on(event, callback);
          if (this.verbose) console.log(green(`[HANDLER] Event '${event}' loaded`));
        } else if (type === 'commands') {
          const { aliases } = importedListener as CommandListener;

          // If we are searching for commands, treat the export as a command, get its properties and push them to the command collection
          this.commands.set(typeof aliases === 'string' ? aliases : aliases.map(a => a.toLowerCase()), listener);
          if (this.verbose)
            console.log(green(`[HANDLER] Command which aliases are [${typeof aliases === 'string' ? aliases : aliases.join(', ')}] loaded`));
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  /*
   * Runs the events and commands (if both are called) folders scan
   */
  readonly run = async ({ onLoadedEvents, onLoadedCommands }: RunCallbacks): Promise<void> => {
    try {
      // Get full path from the directory from which the function was called, which would equal the main file of the project
      const basePath = module.parent.parent.filename;

      const options: GenericUtils = { client: this.client, handler: this };

      const joinFolder = (...folder: string[]): string => join(basePath, '..', ...folder);

      // Make desired actions run
      if (this.eventsFolder) {
        await this.scanFolder(joinFolder(this.eventsFolder), 'events');
        await onLoadedEvents(options);
      }

      if (this.commandsFolder) {
        await this.scanFolder(joinFolder(this.commandsFolder), 'commands');
        await onLoadedCommands(options);
      }
    } catch (e) {
      console.error(e);
    }
  };

  /*
   * Searches for commands based on the received message and makes some verifications
   * @param prefix Supposed prefix to be verified in the message
   * @param message Message instance of the message event
   */
  readonly importCommands = async (prefix: string, message: Message): Promise<void> => {
    // Define initial properties
    const args = message.content.split(' ');
    const commandName = args.shift().slice(prefix.length);

    // Check if the message starts with the correct prefix
    if (!message.content.startsWith(prefix)) return;

    const { client } = this;

    try {
      // Attempt to find the callback from the correct command (if one exists)
      const commandCallback = this.commands.find((_k, v) => v.includes(commandName.toLowerCase()));

      // Run the command with its correct arguments
      if (commandCallback) await commandCallback({ commandName, args, prefix, message, client, handler: this });
    } catch (e) {
      console.error(e);
    }
  };
}
