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

  
  /**
   * Subtracts two numbers.
   * @param a First number
   * @param b Second number
   * @returns The difference of the two numbers
   */
  @tool()
  async minus(a: number, b: number) {
    return a - b;
  }
}