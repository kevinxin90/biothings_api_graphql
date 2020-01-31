
const { ApolloServer, gql } = require('apollo-server');
const axios = require('axios');
const converter = require('biomedical_id_resolver');
const DataLoader = require("dataloader");
var _ = require('lodash');

const queryGene = async(entrez) => {
  let input = 'entrez:' + entrez;
  let res = {};
  let ids = await converter.resolve([input], semanticType='Gene');
  return ids[input];
}

const queryChemical = async(chembl) => {
  let input = 'chembl:' + chembl;
  let ids = await converter.resolve([input], semanticType="ChemicalSubstance");
  return ids[input];
}

const queryDisease = async(mondo) => {
  let input = 'mondo:' + mondo;
  let ids = await converter.resolve([input], semanticType="DiseaseOrPhenotypicFeature");
  return ids[input];
}

const getAssocGenes  = async(parent) => {
  console.log('parent', parent);
  let gene_symbols = parent.assocGenes.map(item => 'symbol:' + item.gene_name);
  let ids = await converter.resolve(gene_symbols, semanticType="Gene");
  for (let [key, val] of Object.entries(ids)) {
    ids[key]['targetedBy'] = [];
  };
  let symbols = Object.values(ids).map(item => item.symbol);
  let api_rsp = await axios.post('http://mychem.info/v1/query', params=`q=${symbols}&scopes=drugbank.targets.gene_name&fields=chembl.molecule_chembl_id&dotfield=true`, headers={'content-type': 'application/x-www-form-urlencoded'});
  console.log(api_rsp.data);
  for (let index in api_rsp.data) {
    console.log(index);
    if ('chembl.molecule_chembl_id' in api_rsp.data[index]) {
      ids['symbol:' + api_rsp.data[index].query]['targetedBy'].push(api_rsp.data[index]);
    }
  };
  console.log(ids);
  return Object.values(ids);
}

const getTarget = async(parent) => {
  let chembl_ids = parent.targetedBy.filter(item => 'chembl.molecule_chembl_id' in item).map(item => 'chembl:' + item['chembl.molecule_chembl_id']);
  let ids = await converter.resolve(chembl_ids, semanticType="ChemicalSubstance");
  return Object.values(ids);
}

const fetchDiseaseCause = async(parent) => {
  let doids = [];
  let api_rsp = await axios.post('http://mydisease.info/v1/query', params=`q=${symbols}&scopes=disgenet.genes_related_to_disease.gene_id&fields=disgenet.xrefs.umls&dotfield=true`, headers={'content-type': 'application/x-www-form-urlencoded'});
  for (let index in data.hits) {
    if ('mondo' in data.hits[index]) {
      doids.push('doid:' + data.hits[index]['mondo']['xrefs']['doid']);
    }
  };
  console.log(doids);
  let ids = await converter.resolve(doids, semanticType="DiseaseOrPhenotypicFeature");
  console.log(ids);
  return Object.values(ids);
}

const transformResponseGene2Disease = async(data) => {
  let doids = [];
  for (let index in data.hits) {
    if ('mondo' in data.hits[index]) {
      doids.push('doid:' + data.hits[index]['mondo']['xrefs']['doid']);
    }
  };
  console.log(doids);
  let ids = await converter.resolve(doids, semanticType="DiseaseOrPhenotypicFeature");
  console.log(ids);
  return Object.values(ids);
}

const fetchChemicalsTargetedByGenes = async(symbols) => {
  let api_rsp = await axios.post('http://mychem.info/v1/query', params=`q=${symbols.join(',')}&scopes=drugbank.targets.gene_name&fields=chembl.molecule_chembl_id&dotfield=true`, headers={'content-type': 'application/x-www-form-urlencoded'});
  let res = {};
  let chembl_ids = api_rsp.data.filter(item => 'chembl.molecule_chembl_id' in item).map(item => 'chembl:' + item['chembl.molecule_chembl_id']);
  let ids = await converter.resolve(chembl_ids, semanticType="ChemicalSubstance");
  for (let index in api_rsp.data) {
    let symbol = 'symbol:' + api_rsp.data[index]['query'];
    if (!(api_rsp.data[index]['query'] in res)) {
      res[api_rsp.data[index]['query']] = [];
    };
    let chembl = _.get(api_rsp.data[index], 'chembl.molecule_chembl_id');
    if (chembl) {
      res[api_rsp.data[index]['query']].push(ids['chembl:' + chembl]);
    }
  }
  return Object.values(res);
}

const fetchChemicalsTargetedByGenesLoader = new DataLoader(keys => fetchChemicalsTargetedByGenes(keys))

const fetchDiseaseasCausedByGenes = async(entrezes) => {
  let api_rsp = await axios.post('http://mydisease.info/v1/query', params=`q=${entrezes.join(',')}&scopes=disgenet.genes_related_to_disease.gene_id&fields=disgenet.xrefs.umls&dotfield=true`, headers={'content-type': 'application/x-www-form-urlencoded'});
  let res = {};
  let umls_ids = [];
  for (let index in api_rsp.data) {
    let umls = _.get(api_rsp.data[index], 'disgenet.xrefs.umls');
    if (_.isArray(umls)) {
      umls = umls.map(item => 'umls:' + item);
      umls_ids = _.union(umls_ids, umls)
    } else if (umls) {
      umls_ids.push('umls:' + umls)
    }
  }
  console.log('umls_ids', umls_ids);
  let ids = await converter.resolve(umls_ids, semanticType="DiseaseOrPhenotypicFeature");
  console.log('ids', ids);
  for (let index in api_rsp.data) {
    let entrez = 'entrez:' + api_rsp.data[index]['query'];
    if (!(api_rsp.data[index]['query'] in res)) {
      res[api_rsp.data[index]['query']] = [];
    };
    let umls_id = _.get(api_rsp.data[index], 'disgenet.xrefs.umls');
    if (_.isArray(umls_id)) {
      let resolved_ids = umls_id.map(item => ids['umls:' + item]);
      res[api_rsp.data[index]['query']] = _.union(res[api_rsp.data[index]['query']], resolved_ids);
    } else if (umls_id) {
      res[api_rsp.data[index]['query']].push(ids['umls:' + umls_id]);
    }
  }
  console.log('res', res);
  return Object.values(res);
}

const fetchDiseaseasCausedByGenesLoader = new DataLoader(keys => fetchDiseaseasCausedByGenes(keys))

const batchFetchGenesAssocWithDiseases = async(umls) => {
  let api_rsp = await axios.post('http://mydisease.info/v1/query', params=`q=${umls.join(',')}&scopes=disgenet.xrefs.umls&fields=disgenet.genes_related_to_disease.gene_id&dotfield=true`, headers={'content-type': 'application/x-www-form-urlencoded'});
  let entrez_ids = [];
  for (let index in api_rsp.data) {
    console.log(api_rsp.data[index]);
    if ('disgenet.genes_related_to_disease.gene_id' in api_rsp.data[index]) {
      let tmp_ids = api_rsp.data[index]['disgenet.genes_related_to_disease.gene_id'].map(item => 'entrez:' + item);
      entrez_ids = entrez_ids.concat(tmp_ids);
    }
  };
  console.log('entrez_ids', entrez_ids);
  let ids = await converter.resolve(entrez_ids, semanticType="Gene");
  console.log(ids);
  return [Object.values(ids)];
}

const fetchGenesAssocWithDiseasesLoader = new DataLoader(keys => batchFetchGenesAssocWithDiseases(keys));

// A schema is a collection of type definitions (hence "typeDefs")
// that together define the "shape" of queries that are executed against
// your data.
const typeDefs = gql`
  type Query {
    gene(entrez: String): Gene
    chemical(chembl:String!): Chemical
    disease(mondo: String!): Disease
  }

  type Gene {
    "Entrez Gene is the NCBI's database for gene-specific information, focusing on completely sequenced genomes, those with an active research community to contribute gene-specific information, or those that are scheduled for intense sequence analysis."
    entrez: String
    "The HGNC (HUGO Gene Nomenclature Committee) provides an approved gene name and symbol (short-form abbreviation) for each known human gene. All approved symbols are stored in the HGNC database, and each symbol is unique. HGNC identifiers refer to records in the HGNC symbol database."
    hgnc: Int
    "HGNC Symbol at HUGO Genome Nomenclature Committee"
    symbol: String
    "Online Mendelian Inheritance in Man"
    omim: String
    "Ensembl at Sanger/EMBL-EBI"
    ensembl: String
    "gene name"
    name: String
    "gene taxonomy"
    taxonomy: Int
    "chemicals targeting genes"
    targetedBy: [Chemical]
    "genes causing diseases"
    causes: [Disease]
  }

  type Chemical {
    chembl: String
    pubchem: String
    umls: String
    drugbank:String
    mesh:String
    name:String
  }

  type Disease {
    mondo: String
    doid: String
    umls: String
    mesh: String
    name: String
    hp: String
    assocWith: [Gene]
  }
`;

const resolvers = {
  Query: {
    gene(parent, args) {
      return queryGene(args.entrez)
    },
    chemical(parent, args) {
      return queryChemical(args.chembl)
    },
    disease(parent, args) {
      return queryDisease(args.mondo)
    }
  },
  Gene: {
    targetedBy: parent => fetchChemicalsTargetedByGenesLoader.load(parent.symbol),
    causes: parent => fetchDiseaseasCausedByGenesLoader.load(parent.entrez)
  },
  Disease: {
    assocWith: parent => fetchGenesAssocWithDiseasesLoader.load(parent.umls)
  }
};

const server = new ApolloServer({ typeDefs, resolvers });

// The `listen` method launches a web server.
server.listen().then(({ url }) => {
  console.log(`🚀  Server ready at ${url}`);
});