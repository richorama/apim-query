import {
  ApiManagementClient,
  ProductContract,
  SubscriptionContract
} from "@azure/arm-apimanagement";
import { DefaultAzureCredential } from "@azure/identity";

interface ICtx {
  client: ApiManagementClient;
  resourceGroupName: string;
  serviceName: string;
}

async function queryApis(ctx: ICtx) {
  const apiToProductMap = new Map<string, ProductContract[]>();

  console.log("querying apis");
  const apisResult = ctx.client.api.listByService(
    ctx.resourceGroupName,
    ctx.serviceName
  );
  for await (const api of apisResult) {
    apiToProductMap.set(api.name || "", []);
  }
  return apiToProductMap;
}

function printResults(
  apiToProductMap: Map<string, ProductContract[]>,
  productSubMap: Map<string, SubscriptionContract[]>,
  allSubscriptionIds: Set<string>
) {
  let totalSubsUsed = 0
  apiToProductMap.forEach((products, api) => {
    const subCount = products.map(product => productSubMap.get(product.name || "")?.length || 0).reduce((a, b) => a + b, 0)
    console.log(
      `API ${api} Products = ${products.length}, Subscriptions = ${subCount}`
    );
    totalSubsUsed += subCount
  });
}

async function queryProductSubscriptions(ctx: ICtx, product: ProductContract, productSubMap: Map<string, SubscriptionContract[]>, allSubscriptionIds: Set<string>){
  console.log(`querying subscriptions for product ${product.name}`);
  const subs = ctx.client.productSubscriptions.list(
    ctx.resourceGroupName,
    ctx.serviceName,
    product.name || ""
  );
  const subscriptions: SubscriptionContract[] = [];
  for await (const sub of subs) {
    subscriptions.push(sub);
    allSubscriptionIds.add(sub.id || "")
  }
  productSubMap.set(product.name || "", subscriptions);
}

async function queryProductApis(ctx: ICtx, product: ProductContract, apiToProductMap: Map<string, ProductContract[]>) {
  
  console.log(`querying apis for ${product.name}`);
  const apis = ctx.client.productApi.listByProduct(
    ctx.resourceGroupName,
    ctx.serviceName,
    product.name || ""
  );
  for await (const api of apis) {
    let prods = apiToProductMap.get(api.name || "");
    if (!prods) {
      prods = [];
      apiToProductMap.set(api.name || "", prods);
    }
    prods.push(product);
  }
}

function splitId(id: string) {
  const parts = id.split("/");
  const result:any = {}
  for (let i = 1; i < parts.length; i += 2) {
    const key = parts[i];
    const value = parts[i + 1];
    result[key] = value;
  }
  return result
}

async function queryApiManagement(
  client: ApiManagementClient,
  resourceGroupName: string,
  serviceName: string
) {
  const ctx = {
    client,
    resourceGroupName,
    serviceName,
  };

  const apiToProductMap = await queryApis(ctx);
  const productSubMap = new Map<string, SubscriptionContract[]>();
  const allSubscriptionIds = new Set<string>()

  console.log("querying products");
  const products = client.product.listByService(resourceGroupName, serviceName);
  for await (const product of products) {
    await queryProductSubscriptions(ctx, product, productSubMap, allSubscriptionIds)
    await queryProductApis(ctx, product, apiToProductMap)
  }
  printResults(apiToProductMap, productSubMap, allSubscriptionIds);
}
async function main() {
  const subscriptionId = process.env.SUBSCRIPTION_ID
  if (!subscriptionId){
    console.log('please set the SUBSCRIPTION_ID environment variable')
    return
  }
  console.log(`using subscription ${subscriptionId}`)
  const credential = new DefaultAzureCredential();
  const client = new ApiManagementClient(credential, subscriptionId);

  const apims = client.apiManagementService.list();
  for await (const apim of apims) {
    const idParts = splitId(apim.id || "")
    const { resourceGroups } = idParts
    console.log(`querying apim ${apim.name} in ${resourceGroups}`);
    await queryApiManagement(client, resourceGroups, apim.name || "");
  }
}

main();
