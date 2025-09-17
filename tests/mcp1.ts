import { tool } from "#fastmcp";

export class GreetingMCP {

  /**
   * Says hello to the given name.
   * 
   * @param name Name to greet
   * @returns A greeting string
   */
  @tool({
    name: "greet",
    description: "Greet a user by name",
  })
  async hi({name}: {name: string}) {
    return `hi ${name}`;
  }
}