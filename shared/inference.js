import {CRITERIA,RULE_VERSION,evaluateCriterion,combineEvidence} from './catalog.js';
import {BANANA_IDENTITY_LABELS,BANANA_VISIBILITY,BANANA_RIPENESS,bananaIdentity,bananaDecision} from './banana-policy.js';
export async function classify(classifier,image,productType,MODEL_ID,revision){
const start=performance.now();
      const criteria=CRITERIA[productType];
      if(!criteria)throw Error('Unsupported product');
      const identityLabels={banana:'a banana fruit',peach:'a peach fruit',watermelon:'a whole watermelon',apple:'an apple fruit',person:'a person',room:'an indoor room',other:'a non-food object'};
      const isBanana=productType==='banana';
      const identityScores=await classifier(image,isBanana?Object.values(BANANA_IDENTITY_LABELS).flat():Object.values(identityLabels),{hypothesis_template:'A photo of {}.'});
      const identityTop=identityScores[0];
      const identity=isBanana?bananaIdentity(identityScores):{matched:identityTop.label===identityLabels[productType]&&identityTop.score>=.50&&identityTop.score-identityScores[1].score>=.08,score:identityTop.score,label:identityTop.label};
      const identityMatched=identity.matched;
      const assessments=[];
      const descriptions={banana:[['a clean ripe banana','a moldy rotten banana','a blurry banana'],['a banana with intact skin','a banana with ripped open skin','a banana obscured by packaging'],['a plump intact banana','a crushed shriveled banana','a blurry banana']],peach:[['a fresh clean peach','a moldy rotten peach','a blurry peach'],['a peach with intact skin','a peach with ripped open skin','a peach obscured by packaging'],['a plump fresh peach','a bruised crushed peach','a blurry peach']],watermelon:[['a fresh green watermelon','a moldy rotten watermelon','a blurry watermelon'],['a whole intact watermelon','a cracked broken watermelon','a watermelon obscured by packaging'],['a fresh round watermelon','a crushed dented watermelon','a blurry watermelon']]};
      if(identityMatched){
        for(const [index,item] of criteria.rules.entries()){
          const [normal,defect,unclear]=descriptions[productType][index]||[item.normal,item.defect,item.unclear],rule={...item,normal,defect,unclear};
          const output=await classifier(image,[normal,defect,unclear],{hypothesis_template:'{}.'});
          assessments.push(evaluateCriterion(rule,output));
        }
      }
      const labels=[`a fresh ${productType} with intact skin, normal color and no visible decay`,`a rotten ${productType} with mold, brown decay, damaged and shriveled skin`,`a blurry, dark or obstructed photo of a ${productType} that is difficult to inspect`,`an unrelated object or empty background, not a ${productType}`];
      const output=await classifier(image,labels,{hypothesis_template:'This is a photo of {}.'});
      const scores=output.map(s=>({...s,kind:['pass','fail','review','review'][labels.indexOf(s.label)]}));
      let decision;
      if(isBanana){
        const visibilityScores=identityMatched?await classifier(image,BANANA_VISIBILITY.map(s=>s.label),{hypothesis_template:'A photo of {}.'}):[];
        const ripenessScores=identityMatched?await classifier(image,BANANA_RIPENESS.map(s=>s.prompt),{hypothesis_template:'A photo of {}.'}):[];
        decision=bananaDecision({scores,assessments,identity,visibilityScores,ripenessScores});
      }else decision=combineEvidence(scores,assessments,identityMatched);
      return {...decision,assessments,identity,criteriaVersion:RULE_VERSION,criteria:{title:criteria.title,normal:criteria.normal,caution:criteria.caution,unobservable:criteria.unobservable,source:criteria.source,sources:criteria.sources,ripenessGuide:criteria.ripenessGuide},scores,model:MODEL_ID,revision:revision,inferenceMs:Math.round(performance.now()-start)};

}
