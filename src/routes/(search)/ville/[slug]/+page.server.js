import { compile } from 'mdsvex';
import aidesAndCollectivities from '$lib/data/aides-collectivities.json';
import communes from '$lib/data/communes.json';
import labelTourDeFrance from '/src/content/label-tour-de-france.json';
import { error } from '@sveltejs/kit';
import { engine } from '$lib/engine';
import { rawCityToFullLocalisation } from '$lib/utils';

const ruleNamePerCollectivity = Object.entries(aidesAndCollectivities).reduce(
	(manifest, [ruleName, { collectivity }]) => {
		manifest[collectivity.kind][collectivity.value] = ruleName;
		return manifest;
	},
	{
		pays: {},
		epci: {},
		'code insee': {},
		région: {},
		département: {}
	}
);

const availableContent = Object.fromEntries(
	Object.entries(import.meta.glob('/src/content/*.svx', { as: 'raw', eager: true })).map(
		([name, mod]) => [
			name
				.split('/')
				.at(-1)
				.toLowerCase()
				.replace(/\.svx$/, ''),
			mod
		]
	)
);

const ruleToContentFilename = (ruleName) => ruleName.toLowerCase().replace('aides . ', '');

const hasCorrespondingContent = (ruleName) =>
	ruleName && Object.keys(availableContent).includes(ruleToContentFilename(ruleName));

const getCorrespondingContent = async (ruleName, { prepend } = {}) => {
	const source = availableContent[ruleToContentFilename(ruleName)];
	const modifiedText = prependPartialSentence(source, { prepend });
	const text = (await compile(modifiedText)).code;
	return text;
};

const prependPartialSentence = (content, { prepend } = {}) =>
	prepend ? prepend + content.slice(0, 1).toLowerCase() + content.slice(1) : content;

/** @type {import('./$types').PageServerLoad} */
export async function load({ params }) {
	const slug = params.slug;
	const localisation = rawCityToFullLocalisation(communes.find((c) => c.slug === slug));

	if (!localisation) {
		throw error(404);
	}

	const baseData = { ville: localisation };
	const infos = {};

	if (localisation.pays && localisation.pays !== 'france') {
		if (hasCorrespondingContent(localisation.pays)) {
			infos.pays = {
				text: await getCorrespondingContent(localisation.pays)
			};
		}
		return { ...baseData, infos };
	}

	const villeRuleName = ruleNamePerCollectivity['code insee'][localisation.code];
	const epciRuleName = ruleNamePerCollectivity['epci'][localisation.epci];
	const departementRuleName = ruleNamePerCollectivity['département'][localisation.departement];
	const regionRuleName = ruleNamePerCollectivity['région'][localisation.region];

	if (
		[villeRuleName, epciRuleName, departementRuleName, regionRuleName].every(
			(ruleName) => ruleName === undefined
		)
	) {
		infos.onlyNationalAides = true;
	}

	if (hasCorrespondingContent(epciRuleName)) {
		infos.epci = {
			ruleName: epciRuleName,
			titre: engine.getRule(epciRuleName).rawNode.titre,
			text: await getCorrespondingContent(epciRuleName)
		};
	}

	if (hasCorrespondingContent(villeRuleName)) {
		infos.ville = {
			ruleName: villeRuleName,
			titre: engine.getRule(villeRuleName).rawNode.titre.replace(/^Ville/, 'la ville'),
			text: await getCorrespondingContent(villeRuleName, {
				prepend: infos.epci ? `En plus de l’aide versée par ${infos.epci.titre}, ` : ''
			})
		};
	}

	if (hasCorrespondingContent(regionRuleName)) {
		infos.region = {
			ruleName: regionRuleName,
			titre: engine.getRule(regionRuleName).rawNode.titre.replace(/^Région/, 'la région'),
			text: await getCorrespondingContent(regionRuleName)
		};
	}

	if (hasCorrespondingContent(departementRuleName)) {
		infos.département = {
			ruleName: departementRuleName,
			titre: engine
				.getRule(departementRuleName)
				.rawNode.titre.replace(/^Département/, 'le département'),
			text: await getCorrespondingContent(departementRuleName, {
				prepend: infos.region ? `En plus de l’aide versée par ${infos.region.titre}, ` : ''
			})
		};
	}

	if (Object.keys(labelTourDeFrance).includes(localisation.nom.toLowerCase())) {
		infos.labelTourDeFrance = {
			ville: localisation.nom,
			note: labelTourDeFrance[localisation.nom.toLowerCase()]
		};
	}

	return { ...baseData, infos };
}
