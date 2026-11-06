import {allowSameOriginPanel,ownerPage} from './protected-page';

export const ownerEmbed=(request:Request)=>new URL(request.url).searchParams.get('embed')==='owner';

export function ownerWorkspacePanel(request:Request,response:Response){
 if(response.status===200&&ownerEmbed(request))allowSameOriginPanel(response.headers);
 return response;
}

export function ownerWorkspaceMarkup(request:Request,html:string){
 if(!ownerEmbed(request))return html;
 return html.replace('</head>','<link rel="stylesheet" href="/owner-panel.css"></head>')
  .replace('<body>','<body class="owner-embedded">');
}

export async function ownerToolPage(request:Request,html:string){
 return ownerWorkspacePanel(request,await ownerPage(request,ownerWorkspaceMarkup(request,html)));
}
