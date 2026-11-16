interface DisplaySettings {
  readonly color:string|boolean|undefined;
  readonly json:boolean;
  readonly terminal:boolean;
  readonly noColor:string|undefined;
  readonly term:string|undefined;
}
const RESET='\u001b[0m';
const HEADING='\u001b[1;36m';
const ERROR='\u001b[1;31m';
const HINT='\u001b[33m';
export class Presentation {
  private readonly enabled:boolean;
  constructor(settings:DisplaySettings){
    // Invalid colour input is still rejected by the parser; its own diagnostic stays plain.
    this.enabled=!settings.json&&(settings.color==='always'||((settings.color===undefined||settings.color==='auto')&&settings.terminal&&(settings.noColor===undefined||settings.noColor==='')&&settings.term!=='dumb'));
  }
  heading(value:string):string{return this.enabled?HEADING+value+RESET:value;}
  error(value:string):string{return this.enabled?ERROR+value+RESET:value;}
  hint(value:string):string{return this.enabled?HINT+value+RESET:value;}
  help(value:string):string{return value.split('\n').map((line,index)=>index===0||line.startsWith('Usage:')||line.endsWith(':')?this.heading(line):line).join('\n');}
}
