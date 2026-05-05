import React, { useState, useEffect } from 'react'
import { useDataQuery } from '@dhis2/app-runtime'
import { 
  OrganisationUnitTree, 
  SingleSelectField,
  SingleSelectOption,
  MultiSelectField,
  MultiSelectOption,
  Button,
  CircularLoader,
  Box,
  Card,
  IconChevronDown24,
  IconChevronUp24,
  Divider,
  NoticeBox,
  Transfer,
  Checkbox
} from '@dhis2/ui'
import { IconCheckmark24 } from '@dhis2/ui-icons'

// Query to fetch data elements
const dataElementsQuery = {
  results: {
    resource: 'dataElements',
    params: {
      fields: 'id,displayName,displayShortName,valueType,domainType',
      paging: 'false',
      filter: 'domainType:eq:AGGREGATE'
    }
  }
}

// Query to fetch indicators
const indicatorsQuery = {
  results: {
    resource: 'indicators',
    params: {
      fields: 'id,displayName,indicatorType[id,displayName],numerator,denominator,indicatorGroups[id,displayName]',
      paging: 'false'
    }
  }
}

// Query to fetch indicator groups
const indicatorGroupsQuery = {
  results: {
    resource: 'indicatorGroups',
    params: {
      fields: 'id,displayName,indicators[id,displayName]',
      paging: 'false'
    }
  }
}

// Query to fetch program indicators
const programIndicatorsQuery = {
  results: {
    resource: 'programIndicators',
    params: {
      fields: 'id,displayName,program[id,displayName],expression,filter',
      paging: 'false'
    }
  }
}

// Query to fetch programs with program indicators
const programsWithIndicatorsQuery = {
  results: {
    resource: 'programs',
    params: {
      fields: 'id,displayName,programIndicators[id,displayName]',
      filter: 'programIndicators:gt:0',
      paging: 'false'
    }
  }
}

// Query to fetch programs (for event data)
const programsQuery = {
  results: {
    resource: 'programs',
    params: {
      fields: 'id,displayName,programStages[programStageDataElements[dataElement[id,displayName]]]',
      paging: 'false'
    }
  }
}

// Query to fetch organization units
const orgUnitsQuery = {
  results: {
    resource: 'organisationUnits',
    params: {
      fields: 'id,displayName,path,level,children[id,displayName,path,level]',
      paging: 'false',
      maxLevel: '2'
    }
  }
}

// Dynamic queries - will be created when needed
// Get data values to check aggregate data availability
const createAggregateDataAvailabilityQuery = (orgUnitId) => ({
  results: {
    resource: 'dataElements',
    params: {
      fields: 'id,displayName',
      filter: 'domainType:eq:AGGREGATE',
      paging: 'false',
      pageSize: 5
    }
  }
})

// Get programs to check event data availability
const createEventDataAvailabilityQuery = (orgUnitId) => ({
  results: {
    resource: 'programs',
    params: {
      filter: 'programType:eq:WITHOUT_REGISTRATION',
      fields: 'id,displayName',
      paging: 'false',
      pageSize: 5
    }
  }
})

// Get tracker programs to check tracker data availability
const createTrackerDataAvailabilityQuery = (orgUnitId) => ({
  results: {
    resource: 'programs',
    params: {
      filter: 'programType:eq:WITH_REGISTRATION',
      fields: 'id,displayName',
      paging: 'false', 
      pageSize: 5
    }
  }
})

// Available periods
const periods = [
  { id: 'THIS_MONTH', name: 'This Month' },
  { id: 'LAST_MONTH', name: 'Last Month' },
  { id: 'THIS_QUARTER', name: 'This Quarter' },
  { id: 'LAST_QUARTER', name: 'Last Quarter' },
  { id: 'THIS_YEAR', name: 'This Year' },
  { id: 'LAST_YEAR', name: 'Last Year' },
  { id: 'LAST_12_MONTHS', name: 'Last 12 Months' }
]

export const DatasetSelector = ({ 
  engine, 
  onDataElementsSelected, 
  onPeriodSelected, 
  onOrgUnitSelected 
}) => {
  const isTreeSelectableOrgUnit = (orgUnit) =>
    Boolean(orgUnit && orgUnit.id && !orgUnit.isSpecial)

  // Data states
  const [dataElements, setDataElements] = useState([])
  const [indicators, setIndicators] = useState([])
  const [programIndicators, setProgramIndicators] = useState([])
  const [programs, setPrograms] = useState([])
  const [selectedDataElements, setSelectedDataElements] = useState([])
  const [selectedPeriod, setSelectedPeriod] = useState('THIS_MONTH')
  const [selectedOrgUnit, setSelectedOrgUnit] = useState(null)
  const [dataType, setDataType] = useState('') // empty by default, options: 'aggregate', 'event', 'tracker', 'indicator', 'programIndicator'
  
  // UI states
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(true)
  const [searchText, setSearchText] = useState('')
  const [transferData, setTransferData] = useState({ options: [] })
  const [rootOrgUnits, setRootOrgUnits] = useState([])
  
  // Step-by-step flow control
  const [selectionStep, setSelectionStep] = useState(1) // 1: OrgUnit, 2: DataType, 3: Program/Dataset, 4: Elements
  const [availableDataTypes, setAvailableDataTypes] = useState({
    aggregate: false,
    indicator: true, // Always available
    programIndicator: true, // Always available
    event: false,
    tracker: false
  })
  
  // Program/Dataset selection state
  const [availablePrograms, setAvailablePrograms] = useState([])
  const [availableDataSets, setAvailableDataSets] = useState([])
  const [availableIndicatorGroups, setAvailableIndicatorGroups] = useState([])
  const [availableProgramsForIndicators, setAvailableProgramsForIndicators] = useState([])
  const [selectedProgram, setSelectedProgram] = useState(null)
  const [selectedDataSet, setSelectedDataSet] = useState(null)
  const [selectedIndicatorGroup, setSelectedIndicatorGroup] = useState(null)
  const [selectedProgramForIndicators, setSelectedProgramForIndicators] = useState(null)
  
  // Multi-org unit breakdown option
  const [includeChildOrgUnits, setIncludeChildOrgUnits] = useState(false)

  // Use static data queries for better performance
  const { loading: dataElementsLoading, error: dataElementsError, data: dataElementsData } = 
    useDataQuery(dataElementsQuery);
  
  const { loading: indicatorsLoading, error: indicatorsError, data: indicatorsData } = 
    useDataQuery(indicatorsQuery);
    
  const { loading: indicatorGroupsLoading, error: indicatorGroupsError, data: indicatorGroupsData } = 
    useDataQuery(indicatorGroupsQuery);
  
  const { loading: programIndicatorsLoading, error: programIndicatorsError, data: programIndicatorsData } = 
    useDataQuery(programIndicatorsQuery);
    
  const { loading: programsWithIndicatorsLoading, error: programsWithIndicatorsError, data: programsWithIndicatorsData } = 
    useDataQuery(programsWithIndicatorsQuery);
  
  const { loading: programsLoading, error: programsError, data: programsData } = 
    useDataQuery(programsQuery);
  
  const { loading: orgUnitsLoading, error: orgUnitsError, data: orgUnitsData } = 
    useDataQuery(orgUnitsQuery);
  
  // Process data when it's available
  useEffect(() => {
    if (!dataElementsLoading && !indicatorsLoading && !indicatorGroupsLoading && 
        !programIndicatorsLoading && !programsWithIndicatorsLoading && 
        !programsLoading && !orgUnitsLoading) {
      try {
        // Process data elements
        const fetchedDataElements = dataElementsData?.results?.dataElements || [];
        setDataElements(fetchedDataElements);
        
        // Process indicators
        const fetchedIndicators = indicatorsData?.results?.indicators || [];
        setIndicators(fetchedIndicators);
        
        // Process indicator groups
        const fetchedIndicatorGroups = indicatorGroupsData?.results?.indicatorGroups || [];
        setAvailableIndicatorGroups(fetchedIndicatorGroups.map(group => ({
          id: group.id,
          displayName: group.displayName,
          indicatorCount: group.indicators ? group.indicators.length : 0
        })));
        
        // Process program indicators
        const fetchedProgramIndicators = programIndicatorsData?.results?.programIndicators || [];
        setProgramIndicators(fetchedProgramIndicators);
        
        // Process programs with program indicators
        const fetchedProgramsWithIndicators = programsWithIndicatorsData?.results?.programs || [];
        setAvailableProgramsForIndicators(fetchedProgramsWithIndicators.map(program => ({
          id: program.id,
          displayName: program.displayName,
          indicatorCount: program.programIndicators ? program.programIndicators.length : 0
        })));
        
        // Process programs
        const fetchedPrograms = programsData?.results?.programs || [];
        setPrograms(fetchedPrograms);
        
        // Process organization units
        const fetchedOrgUnits = orgUnitsData?.results?.organisationUnits || [];
        setRootOrgUnits(fetchedOrgUnits.map(ou => ou.id));
        
        // Prepare transfer data
        const options = fetchedDataElements.map(de => ({
          label: de.displayName,
          value: de.id
        }));
        
        setTransferData({
          options,
          selected: [],
          leftHeader: 'Available data elements',
          rightHeader: 'Selected data elements',
        });
        
        setLoading(false);
      } catch (err) {
        console.error("Error processing data:", err);
        setError(err.message || "An error occurred processing the data");
        setLoading(false);
      }
    }
  }, [dataElementsLoading, indicatorsLoading, indicatorGroupsLoading, 
      programIndicatorsLoading, programsWithIndicatorsLoading, programsLoading, orgUnitsLoading, 
      dataElementsData, indicatorGroupsData, indicatorsData, programIndicatorsData, programsWithIndicatorsData, programsData, orgUnitsData]);
  
  // Handle errors from any query
  useEffect(() => {
    const firstError = dataElementsError || indicatorsError || indicatorGroupsError || 
                        programIndicatorsError || programsWithIndicatorsError || 
                        programsError || orgUnitsError;
    if (firstError) {
      console.error("Query error:", firstError);
      setError(firstError.message || "An error occurred loading data");
      setLoading(false);
    }
  }, [dataElementsError, indicatorsError, indicatorGroupsError, 
      programIndicatorsError, programsWithIndicatorsError, programsError, orgUnitsError]);

  const handlePeriodChange = ({ selected }) => {
    setSelectedPeriod(selected)
    onPeriodSelected(selected)
  }

  // Handle special organization unit selections (USER_ORGUNIT, USER_ORGUNIT_CHILDREN, USER_ORGUNIT_GRANDCHILDREN)
  const handleSpecialOrgUnitSelect = async (specialOrgUnitType) => {
    try {
      // Clear previous selections
      setSelectedDataElements([]);
      onDataElementsSelected([]);
      
      // Set loading state
      setLoading(true);
      setError(null);
      
      // Map the special org unit type to a display name
      const displayNames = {
        'USER_ORGUNIT': 'User organisation unit',
        'USER_ORGUNIT_CHILDREN': 'User sub-units',
        'USER_ORGUNIT_GRANDCHILDREN': 'User sub-x2-units'
      };
      
      // Create a special org unit object
      const specialOrgUnit = {
        id: specialOrgUnitType,
        displayName: displayNames[specialOrgUnitType] || specialOrgUnitType,
        path: '',
        isSpecial: true
      };
      
      // Update selected org unit
      setSelectedOrgUnit(specialOrgUnit);
      
      // Pass special org unit with multi-org unit setting
      const specialOrgUnitWithSettings = {
        ...specialOrgUnit,
        includeChildOrgUnits: includeChildOrgUnits
      };
      onOrgUnitSelected(specialOrgUnitWithSettings);
      
      // Special org units always have data available
      setAvailableDataTypes({
        aggregate: true,
        indicator: true,
        programIndicator: true,
        event: true,
        tracker: true
      });
      
      // Move to data type selection
      setSelectionStep(2);
      setLoading(false);
    } catch (err) {
      console.error("Error setting special org unit:", err);
      setError("Error setting special org unit: " + (err.message || "Unknown error"));
      setLoading(false);
    }
  };

  const handleOrgUnitChange = async (orgUnitData) => {
    try {
      // Clear previous selections when changing org unit
      setSelectedDataElements([]);
      onDataElementsSelected([]);
      
      // Set loading state
      setLoading(true);
      setError(null);
      
      // The OrganisationUnitTree returns a full object with the org unit details
      console.log("Raw orgUnit from tree:", orgUnitData);
      
      // Process the org unit data based on what we received
      let fullOrgUnit;
      
      // Check if we received a full object with ID and displayName
      if (orgUnitData && typeof orgUnitData === 'object' && orgUnitData.id) {
        // We already have a full org unit object
        fullOrgUnit = {
          id: orgUnitData.id,
          displayName: orgUnitData.displayName || `Org Unit (${orgUnitData.id})`,
          path: orgUnitData.path || '',
        };
        
        console.log("Using provided org unit object:", fullOrgUnit);
      } 
      // Check if we received just an ID as a string
      else if (orgUnitData && typeof orgUnitData === 'string') {
        // We need to fetch the full details
        fullOrgUnit = {
          id: orgUnitData,
          displayName: `Org Unit (${orgUnitData})`
        };
        
        try {
          // Fetch the org unit details to get the display name
          const response = await engine.query({
            orgUnit: {
              resource: `organisationUnits/${orgUnitData}`,
              params: {
                fields: 'id,displayName,path'
              }
            }
          });
          
          if (response && response.orgUnit) {
            fullOrgUnit.displayName = response.orgUnit.displayName;
            fullOrgUnit.path = response.orgUnit.path;
          }
        } catch (err) {
          console.error("Error fetching org unit details:", err);
          // Keep the default display name
        }
      }
      // Invalid input
      else {
        console.error("Invalid org unit data received:", orgUnitData);
        setError("Invalid organization unit selected");
        setLoading(false);
        return;
      }
      
      // Update selected org unit
      setSelectedOrgUnit(fullOrgUnit);
      
      // Pass org unit with multi-org unit setting
      const orgUnitWithSettings = {
        ...fullOrgUnit,
        includeChildOrgUnits: includeChildOrgUnits
      };
      onOrgUnitSelected(orgUnitWithSettings);
      
      // Check data availability for the selected org unit
      if (fullOrgUnit && fullOrgUnit.id) {
        console.log("Checking data availability for org unit:", fullOrgUnit);
        
        // Create availability queries using the org unit ID
        const aggregateDataQuery = createAggregateDataAvailabilityQuery(fullOrgUnit.id);
        const eventDataQuery = createEventDataAvailabilityQuery(fullOrgUnit.id);
        const trackerDataQuery = createTrackerDataAvailabilityQuery(fullOrgUnit.id);
        
        // Execute queries in parallel using Promise.all
        const [aggregateData, eventData, trackerData] = await Promise.all([
          engine.query(aggregateDataQuery).catch(() => ({ results: { dataElements: [] } })),
          engine.query(eventDataQuery).catch(() => ({ results: { programs: [] } })),
          engine.query(trackerDataQuery).catch(() => ({ results: { programs: [] } }))
        ]);
        
        // Determine which data types are available
        const hasAggregateData = aggregateData?.results?.dataElements?.length > 0;
        const hasEventData = eventData?.results?.programs?.length > 0;
        const hasTrackerData = trackerData?.results?.programs?.length > 0;
        
        console.log("Data availability:", {
          aggregate: hasAggregateData,
          event: hasEventData,
          tracker: hasTrackerData
        });
        
        setAvailableDataTypes({
          aggregate: hasAggregateData,
          indicator: true, // Always available
          programIndicator: true, // Always available
          event: hasEventData,
          tracker: hasTrackerData
        });
        
        // Don't set any default data type - leave it empty so user must choose
        
        // Update selection step
        setSelectionStep(2); // Move to data type selection
      }
      
      setLoading(false);
    } catch (err) {
      console.error("Error checking data availability:", err);
      setError("Error checking data availability: " + (err.message || "Unknown error"));
      setLoading(false);
    }
  }

  const handleDataTypeChange = async ({ selected }) => {
    try {
      // Set loading state and reset selections
      setLoading(true);
      setDataType(selected);
      setSelectedDataElements([]);
      setSelectedProgram(null);
      setSelectedDataSet(null);
      onDataElementsSelected([]);
      
      if (selectedOrgUnit) {
        // Fetch programs or datasets based on data type
        let query;
        
        // Reset available programs and datasets
        setAvailablePrograms([]);
        setAvailableDataSets([]);
        
        // Create appropriate query for the selected data type
        if (selected === 'aggregate') {
          // For aggregate data, fetch available datasets
          query = {
            dataSets: {
              resource: 'dataSets',
              params: {
                fields: 'id,displayName,periodType,formType,dataSetElements[dataElement[id,displayName,valueType]]',
                paging: 'false'
              }
            }
          };
          
          try {
            const response = await engine.query(query);
            const dataSets = response.dataSets.dataSets || [];
            
            if (dataSets.length > 0) {
              // Store available datasets
              setAvailableDataSets(dataSets.map(ds => ({
                id: ds.id,
                displayName: ds.displayName,
                periodType: ds.periodType,
                formType: ds.formType,
                dataElementCount: ds.dataSetElements ? ds.dataSetElements.length : 0
              })));
              
              // Move to program/dataset selection step
              setSelectionStep(3);
            } else {
              setError("No datasets found for the selected organization unit");
            }
          } catch (err) {
            console.error("Error fetching datasets:", err);
            setError("Error fetching datasets: " + (err.message || "Unknown error"));
          }
          
        } else if (selected === 'indicator') {
          // For indicators, show indicator groups first
          setLoading(true);
          
          // Reset selections
          setSelectedIndicatorGroup(null);
          
          // Move to indicator group selection step
          setSelectionStep(3);
          setLoading(false);
          
        } else if (selected === 'programIndicator') {
          // For program indicators, show programs with indicators first
          setLoading(true);
          
          // Reset selections
          setSelectedProgramForIndicators(null);
          
          // Move to program selection step
          setSelectionStep(3);
          setLoading(false);
          
        } else if (selected === 'event') {
          // For event data, fetch available event programs
          query = {
            programs: {
              resource: 'programs',
              params: {
                fields: 'id,displayName,description,programType,programStages[id,displayName]',
                filter: 'programType:eq:WITHOUT_REGISTRATION',
                paging: 'false'
              }
            }
          };
          
          try {
            const response = await engine.query(query);
            const programs = response.programs.programs || [];
            
            if (programs.length > 0) {
              // Store available event programs
              setAvailablePrograms(programs.map(program => ({
                id: program.id,
                displayName: program.displayName,
                description: program.description || '',
                type: 'event',
                stages: program.programStages || []
              })));
              
              // Move to program selection step
              setSelectionStep(3);
            } else {
              setError("No event programs found for the selected organization unit");
            }
          } catch (err) {
            console.error("Error fetching event programs:", err);
            setError("Error fetching event programs: " + (err.message || "Unknown error"));
          }
          
        } else if (selected === 'tracker') {
          // For tracker data, fetch available tracker programs
          query = {
            programs: {
              resource: 'programs',
              params: {
                fields: 'id,displayName,description,programType,trackedEntityType[id,displayName]',
                filter: 'programType:eq:WITH_REGISTRATION',
                paging: 'false'
              }
            }
          };
          
          try {
            const response = await engine.query(query);
            const programs = response.programs.programs || [];
            
            if (programs.length > 0) {
              // Store available tracker programs
              setAvailablePrograms(programs.map(program => ({
                id: program.id,
                displayName: program.displayName,
                description: program.description || '',
                type: 'tracker',
                trackedEntityType: program.trackedEntityType ? program.trackedEntityType.displayName : 'Unknown'
              })));
              
              // Move to program selection step
              setSelectionStep(3);
            } else {
              setError("No tracker programs found for the selected organization unit");
            }
          } catch (err) {
            console.error("Error fetching tracker programs:", err);
            setError("Error fetching tracker programs: " + (err.message || "Unknown error"));
          }
        }
        
        // Reset elements for clean UI if not indicators or program indicators
        if (selected !== 'indicator' && selected !== 'programIndicator') {
          setTransferData({
            options: [],
            selected: [],
            leftHeader: `Available data elements`,
            rightHeader: 'Selected data elements',
          });
        }
      }
      
      setLoading(false);
    } catch (err) {
      console.error("Error filtering data elements:", err);
      setError("Error filtering data elements: " + (err.message || "Unknown error"));
      setLoading(false);
    }
  }

  // Store selected data elements with their parent information
  const [selectedElementsWithMetadata, setSelectedElementsWithMetadata] = useState([]);
  
  // Handle indicator group selection
  const handleIndicatorGroupSelect = async (indicatorGroupId) => {
    try {
      setLoading(true);
      setError(null);
      setSelectedDataElements([]);
      onDataElementsSelected([]);
      
      // Find the selected indicator group
      const indicatorGroup = availableIndicatorGroups.find(g => g.id === indicatorGroupId);
      if (!indicatorGroup) {
        setError("Indicator group not found");
        setLoading(false);
        return;
      }
      
      setSelectedIndicatorGroup(indicatorGroup);
      
      // Fetch indicators for this group
      const query = {
        results: {
          resource: 'indicatorGroups/' + indicatorGroupId,
          params: {
            fields: 'id,displayName,indicators[id,displayName,indicatorType[id,displayName]]'
          }
        }
      };
      
      const response = await engine.query(query);
      const groupData = response.results;
      
      const indicators = [];
      
      if (groupData && groupData.indicators) {
        groupData.indicators.forEach(indicator => {
          indicators.push({
            ...indicator,
            parentName: groupData.displayName,
            indicatorGroupId: indicatorGroupId
          });
        });
      }
      
      // Update transfer with indicators
      const options = indicators.map(ind => ({
        label: `${ind.displayName} [${ind.parentName}]`,
        value: ind.id,
        parentName: ind.parentName || '',
        valueType: 'NUMBER'
      }));
      
      setTransferData({
        options,
        selected: [],
        leftHeader: `Available indicators from ${indicatorGroup.displayName}`,
        rightHeader: 'Selected indicators',
      });
      
      // Move to indicators selection step
      setSelectionStep(4);
      setLoading(false);
    } catch (err) {
      console.error("Error fetching indicators:", err);
      setError("Error fetching indicators: " + (err.message || "Unknown error"));
      setLoading(false);
    }
  };
  
  // Handle program for program indicators selection
  const handleProgramForIndicatorsSelect = async (programId) => {
    try {
      setLoading(true);
      setError(null);
      setSelectedDataElements([]);
      onDataElementsSelected([]);
      
      // Find the selected program
      const program = availableProgramsForIndicators.find(p => p.id === programId);
      if (!program) {
        setError("Program not found");
        setLoading(false);
        return;
      }
      
      setSelectedProgramForIndicators(program);
      
      // Fetch program indicators for this program
      const query = {
        results: {
          resource: 'programs/' + programId,
          params: {
            fields: 'id,displayName,programIndicators[id,displayName,expression]'
          }
        }
      };
      
      const response = await engine.query(query);
      const programData = response.results;
      
      const programIndicators = [];
      
      if (programData && programData.programIndicators) {
        programData.programIndicators.forEach(indicator => {
          programIndicators.push({
            ...indicator,
            parentName: programData.displayName,
            programId: programId
          });
        });
      }
      
      // Update transfer with program indicators
      const options = programIndicators.map(pi => ({
        label: `${pi.displayName} [${pi.parentName}]`,
        value: pi.id,
        parentName: pi.parentName || '',
        valueType: 'NUMBER'
      }));
      
      setTransferData({
        options,
        selected: [],
        leftHeader: `Available program indicators from ${program.displayName}`,
        rightHeader: 'Selected program indicators',
      });
      
      // Move to program indicators selection step
      setSelectionStep(4);
      setLoading(false);
    } catch (err) {
      console.error("Error fetching program indicators:", err);
      setError("Error fetching program indicators: " + (err.message || "Unknown error"));
      setLoading(false);
    }
  };
  
  // Handle program selection
  const handleProgramSelect = async (programId) => {
    try {
      setLoading(true);
      setError(null);
      setSelectedDataElements([]);
      onDataElementsSelected([]);
      
      // Find the selected program
      const program = availablePrograms.find(p => p.id === programId);
      if (!program) {
        setError("Program not found");
        setLoading(false);
        return;
      }
      
      setSelectedProgram(program);
      
      // Clear any previously selected dataset
      setSelectedDataSet(null);
      
      let query;
      let dataElements = [];
      
      if (program.type === 'event') {
        // For event programs, fetch program stage data elements
        query = {
          results: {
            resource: 'programs/' + programId,
            params: {
              fields: 'id,displayName,programStages[id,displayName,programStageDataElements[dataElement[id,displayName,valueType]]]'
            }
          }
        };
        
        const response = await engine.query(query);
        const programData = response.results;
        
        if (programData && programData.programStages) {
          // Extract data elements from program stages
          programData.programStages.forEach(stage => {
            if (stage.programStageDataElements) {
              stage.programStageDataElements.forEach(psde => {
                if (psde.dataElement) {
                  // Avoid duplicates
                  if (!dataElements.find(de => de.id === psde.dataElement.id)) {
                    dataElements.push({
                      ...psde.dataElement,
                      parentName: `${programData.displayName} > ${stage.displayName}`,
                      programId: programId,
                      stageId: stage.id
                    });
                  }
                }
              });
            }
          });
        }
      } else if (program.type === 'tracker') {
        // For tracker programs, fetch both program attributes and program stage data elements
        query = {
          program: {
            resource: 'programs/' + programId,
            params: {
              fields: 'id,displayName,programTrackedEntityAttributes[trackedEntityAttribute[id,displayName,valueType]],programStages[id,displayName,programStageDataElements[dataElement[id,displayName,valueType]]]'
            }
          }
        };
        
        const response = await engine.query(query);
        const programData = response.program;
        
        if (programData) {
          // Extract tracked entity attributes
          if (programData.programTrackedEntityAttributes) {
            programData.programTrackedEntityAttributes.forEach(ptea => {
              if (ptea.trackedEntityAttribute) {
                dataElements.push({
                  ...ptea.trackedEntityAttribute,
                  parentName: `${programData.displayName} (Attribute)`,
                  programId: programId,
                  isAttribute: true
                });
              }
            });
          }
          
          // Extract data elements from program stages
          if (programData.programStages) {
            programData.programStages.forEach(stage => {
              if (stage.programStageDataElements) {
                stage.programStageDataElements.forEach(psde => {
                  if (psde.dataElement) {
                    dataElements.push({
                      ...psde.dataElement,
                      parentName: `${programData.displayName} > ${stage.displayName}`,
                      programId: programId,
                      stageId: stage.id
                    });
                  }
                });
              }
            });
          }
        }
      }
      
      // Update transfer with data elements
      const options = dataElements.map(de => ({
        label: `${de.displayName} [${de.parentName}]`,
        value: de.id,
        parentName: de.parentName || '',
        valueType: de.valueType || ''
      }));
      
      setTransferData({
        options,
        selected: [],
        leftHeader: `Available data elements for ${program.displayName}`,
        rightHeader: 'Selected data elements',
      });
      
      // Move to data elements selection step
      setSelectionStep(4);
      setLoading(false);
    } catch (err) {
      console.error("Error fetching program data elements:", err);
      setError("Error fetching program data elements: " + (err.message || "Unknown error"));
      setLoading(false);
    }
  };
  
  // Handle dataset selection
  const handleDataSetSelect = async (dataSetId) => {
    try {
      setLoading(true);
      setError(null);
      setSelectedDataElements([]);
      onDataElementsSelected([]);
      
      // Find the selected dataset
      const dataSet = availableDataSets.find(ds => ds.id === dataSetId);
      if (!dataSet) {
        setError("Dataset not found");
        setLoading(false);
        return;
      }
      
      setSelectedDataSet(dataSet);
      
      // Clear any previously selected program
      setSelectedProgram(null);
      
      // Fetch data elements for this dataset
      const query = {
        results: {
          resource: 'dataSets/' + dataSetId,
          params: {
            fields: 'id,displayName,dataSetElements[dataElement[id,displayName,valueType]]'
          }
        }
      };
      
      const response = await engine.query(query);
      const dataSetData = response.results;
      
      const dataElements = [];
      
      if (dataSetData && dataSetData.dataSetElements) {
        dataSetData.dataSetElements.forEach(dse => {
          if (dse.dataElement) {
            dataElements.push({
              ...dse.dataElement,
              parentName: dataSetData.displayName,
              dataSetId: dataSetId
            });
          }
        });
      }
      
      // Update transfer with data elements
      const options = dataElements.map(de => ({
        label: `${de.displayName} [${de.parentName}]`,
        value: de.id,
        parentName: de.parentName || '',
        valueType: de.valueType || ''
      }));
      
      setTransferData({
        options,
        selected: [],
        leftHeader: `Available data elements for ${dataSet.displayName}`,
        rightHeader: 'Selected data elements',
      });
      
      // Move to data elements selection step
      setSelectionStep(4);
      setLoading(false);
    } catch (err) {
      console.error("Error fetching dataset data elements:", err);
      setError("Error fetching dataset data elements: " + (err.message || "Unknown error"));
      setLoading(false);
    }
  };
  
  const handleTransferChange = ({ selected }) => {
    console.log("Selected elements:", selected);
    setSelectedDataElements(selected);
    
    if (selected.length > 0) {
      // We need to find the full data element objects that match the selected IDs
      // Since we're now fetching different types of data, we need a more flexible approach
      
      // If we're working with transferData.options, we can use that to find the selected items
      const selectedWithMetadata = selected.map(id => {
        const option = transferData.options.find(opt => opt.value === id);
        return {
          id: id,
          displayName: option ? option.label : id, // Fallback to ID if label not found
          parentName: option ? option.parentName : '', // Include parent information
          valueType: option ? option.valueType : '',
          type: dataType // Track which type of data this is
        };
      });
      
      setSelectedElementsWithMetadata(selectedWithMetadata);
      
      // For the DHIS2 API, we need to pass more detailed information
      console.log("Notifying parent component with selected elements:", selectedWithMetadata);

      // Pass both the enriched metadata and the dataType to the parent
      // This provides more context for the data fetching process
      onDataElementsSelected(selected, dataType, selectedWithMetadata);
    } else {
      // If no elements are selected, clear the selections
      setSelectedElementsWithMetadata([]);
      onDataElementsSelected([]);
    }
  }

  return (
    <Card>
      <Box padding="24px" marginBottom="16px">
        <div className="header" onClick={() => setExpanded(!expanded)}>
          <Button small icon={expanded ? <IconChevronUp24 /> : <IconChevronDown24 />}>
            {expanded ? 'Collapse' : 'Expand'}
          </Button>
        </div>
        
        {expanded && (
          <>
            <Divider margin="16px 0" />
            
            {error && (
              <NoticeBox error title="Error loading data">
                {error}
              </NoticeBox>
            )}
            
            {loading ? (
              <Box margin="16px 0" display="flex" justifyContent="center">
                <CircularLoader />
              </Box>
            ) : (
              <div className="data-selector" style={{ marginBottom: '16px' }}>
                {/* Left side: Steps 1-2-3 */}
                <div style={{ width: '350px', flexShrink: 0, marginRight: '24px' }}>
                  {/* Step 1: Organization Unit Selection - Compact version */}
                  <Box 
                    margin="0 0 8px 0" 
                    padding="8px 12px"
                    borderColor={selectionStep === 1 ? '#2196F3' : '#e0e0e0'} 
                    borderWidth="2px"
                    borderStyle="solid"
                    borderRadius="4px"
                  >
                    <details open={selectionStep === 1}>
                      <summary style={{ fontWeight: 'bold', cursor: 'pointer', marginBottom: '8px' }}>
                        Step 1: Select Organization Unit {selectedOrgUnit && <IconCheckmark24 style={{ color: '#4caf50' }} />}
                      </summary>
                      
                      <p style={{ fontSize: '14px', marginBottom: '8px' }}>Select an organization unit</p>
                      
                      {/* Special org units options */}
                      <div style={{ marginBottom: '8px' }}>
                        <Button 
                          small
                          onClick={() => handleSpecialOrgUnitSelect('USER_ORGUNIT')}
                          style={{ marginRight: '8px' }}
                        >
                          User org unit
                        </Button>
                        <Button 
                          small
                          onClick={() => handleSpecialOrgUnitSelect('USER_ORGUNIT_CHILDREN')}
                          style={{ marginRight: '8px' }}
                        >
                          User sub-units
                        </Button>
                        <Button 
                          small
                          onClick={() => handleSpecialOrgUnitSelect('USER_ORGUNIT_GRANDCHILDREN')}
                        >
                          User sub-x2-units
                        </Button>
                      </div>
                      
                      {/* Multi-org unit breakdown option */}
                      <div style={{ marginBottom: '8px', padding: '8px', background: '#f0f8ff', borderRadius: '4px' }}>
                        <Checkbox
                          checked={includeChildOrgUnits}
                          label="Include child organization units breakdown"
                          onChange={({ checked }) => setIncludeChildOrgUnits(checked)}
                        />
                        {includeChildOrgUnits && (
                          <p style={{ fontSize: '12px', margin: '4px 0 0 24px', color: '#666' }}>
                            Data will be analyzed separately for each child org unit, enabling comparative analysis
                          </p>
                        )}
                      </div>
                      
                      <div style={{ 
                        border: '1px solid #e0e0e0', 
                        height: '250px', 
                        overflow: 'auto', 
                        padding: '8px',
                        backgroundColor: '#f9f9f9'
                      }}>
                        {rootOrgUnits.length > 0 ? (
                          <OrganisationUnitTree
                            roots={rootOrgUnits}
                            onChange={handleOrgUnitChange}
                            selected={isTreeSelectableOrgUnit(selectedOrgUnit) ? [selectedOrgUnit.id] : []}
                            singleSelection
                            initiallyExpanded={[]}
                          />
                        ) : (
                          <NoticeBox title="No organization units">
                            No organization units found or you don't have access to any.
                          </NoticeBox>
                        )}
                      </div>
                      
                      {selectedOrgUnit && (
                        <Box background="#f0f8ff" padding="8px" margin="8px 0 0 0" borderRadius="4px">
                          <strong>Selected:</strong> <IconCheckmark24 style={{ color: '#4caf50', marginRight: '4px' }} />{selectedOrgUnit.displayName}
                        </Box>
                      )}
                    </details>
                  </Box>
                  
                  {/* Step 2: Data Type Selection - Compact version */}
                  <Box 
                    margin="0 0 8px 0" 
                    padding="8px 12px"
                    borderColor={selectionStep === 2 ? '#2196F3' : '#e0e0e0'} 
                    borderWidth="2px"
                    borderStyle="solid"
                    borderRadius="4px"
                    opacity={selectionStep < 2 ? 0.6 : 1}
                  >
                    <details open={selectionStep === 2} disabled={selectionStep < 2}>
                      <summary style={{ fontWeight: 'bold', cursor: selectionStep >= 2 ? 'pointer' : 'not-allowed', marginBottom: '8px' }}>
                        Step 2: Select Data Type {dataType && selectionStep > 2 && <span style={{ color: '#4caf50' }}>✓</span>}
                      </summary>
                      
                      <SingleSelectField
                        label="Data Type"
                        selected={dataType}
                        onChange={handleDataTypeChange}
                        className="selector-field"
                        disabled={selectionStep < 2}
                        dense
                        placeholder="Please select a data type"
                        empty={!dataType}
                      >
                        <SingleSelectOption 
                          value="aggregate" 
                          label={availableDataTypes.aggregate ? "Aggregate Data ✓" : "Aggregate Data (No data available)"}
                          disabled={!availableDataTypes.aggregate} 
                        />
                        <SingleSelectOption 
                          value="indicator" 
                          label="Indicators ✓"
                        />
                        <SingleSelectOption 
                          value="programIndicator" 
                          label="Program Indicators ✓"
                        />
                        <SingleSelectOption 
                          value="event" 
                          label={availableDataTypes.event ? "Event Data ✓" : "Event Data (No data available)"} 
                          disabled={!availableDataTypes.event}
                        />
                        <SingleSelectOption 
                          value="tracker" 
                          label={availableDataTypes.tracker ? "Tracker Data ✓" : "Tracker Data (No data available)"}
                          disabled={!availableDataTypes.tracker} 
                        />
                      </SingleSelectField>
                      
                      {dataType && selectionStep > 2 && (
                        <Box background="#f0f8ff" padding="8px" margin="8px 0 0 0" borderRadius="4px">
                          <strong>Selected:</strong> <span style={{ color: '#4caf50', marginRight: '4px' }}>✓</span>{
  dataType === 'aggregate' ? 'Aggregate Data' : 
  dataType === 'indicator' ? 'Indicators' : 
  dataType === 'programIndicator' ? 'Program Indicators' : 
  dataType === 'event' ? 'Event Data' : 
  'Tracker Data'
}
                        </Box>
                      )}
                    </details>
                  </Box>
                  
                  {/* Step 3: Program/Dataset Selection - New step */}
                  <Box 
                    margin="0 0 8px 0" 
                    padding="8px 12px"
                    borderColor={selectionStep === 3 ? '#2196F3' : '#e0e0e0'} 
                    borderWidth="2px"
                    borderStyle="solid"
                    borderRadius="4px"
                    opacity={selectionStep < 3 ? 0.6 : 1}
                  >
                    <details open={selectionStep === 3} disabled={selectionStep < 3}>
                      <summary style={{ fontWeight: 'bold', cursor: selectionStep >= 3 ? 'pointer' : 'not-allowed', marginBottom: '8px' }}>
                        Step 3: Select {
                          dataType === 'aggregate' ? 'Dataset' : 
                          dataType === 'indicator' ? 'Indicators' : 
                          dataType === 'programIndicator' ? 'Program Indicators' : 
                          'Program'
                        } {(selectedProgram || selectedDataSet) && <span style={{ color: '#4caf50' }}>✓</span>}
                      </summary>
                      
                      {dataType === 'aggregate' && (
                        <div>
                          <p style={{ fontSize: '14px', marginBottom: '8px' }}>Select a dataset</p>
                          
                          <div style={{ 
                            maxHeight: '200px', 
                            overflow: 'auto', 
                            border: '1px solid #e0e0e0',
                            borderRadius: '4px',
                            backgroundColor: '#f9f9f9'
                          }}>
                            {availableDataSets.length > 0 ? (
                              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <tbody>
                                  {availableDataSets.map(dataSet => (
                                    <tr 
                                      key={dataSet.id}
                                      onClick={() => handleDataSetSelect(dataSet.id)}
                                      style={{ 
                                        cursor: 'pointer',
                                        backgroundColor: selectedDataSet && selectedDataSet.id === dataSet.id ? '#e3f2fd' : 'transparent',
                                        borderBottom: '1px solid #e0e0e0'
                                      }}
                                    >
                                      <td style={{ padding: '8px' }}>
                                        <div style={{ fontWeight: 'bold' }}>{dataSet.displayName}</div>
                                        <div style={{ fontSize: '12px', color: '#666' }}>
                                          {dataSet.dataElementCount} elements • {dataSet.periodType} • {dataSet.formType || 'Default'} form
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <Box padding="8px">
                                <p>No datasets available</p>
                              </Box>
                            )}
                          </div>
                          
                          {selectedDataSet && (
                            <Box background="#f0f8ff" padding="8px" margin="8px 0 0 0" borderRadius="4px">
                              <strong>Selected:</strong> <span style={{ color: '#4caf50', marginRight: '4px' }}>✓</span>{selectedDataSet.displayName}
                            </Box>
                          )}
                        </div>
                      )}
                      
                      {/* Show indicator groups for indicator selection */}
                      {dataType === 'indicator' && (
                        <div>
                          <p style={{ fontSize: '14px', marginBottom: '8px' }}>Select an indicator group</p>
                          
                          <div style={{ 
                            maxHeight: '200px', 
                            overflow: 'auto', 
                            border: '1px solid #e0e0e0',
                            borderRadius: '4px',
                            backgroundColor: '#f9f9f9'
                          }}>
                            {availableIndicatorGroups.length > 0 ? (
                              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <tbody>
                                  {availableIndicatorGroups.map(group => (
                                    <tr 
                                      key={group.id}
                                      onClick={() => handleIndicatorGroupSelect(group.id)}
                                      style={{ 
                                        cursor: 'pointer',
                                        backgroundColor: selectedIndicatorGroup && selectedIndicatorGroup.id === group.id ? '#e3f2fd' : 'transparent',
                                        borderBottom: '1px solid #e0e0e0'
                                      }}
                                    >
                                      <td style={{ padding: '8px' }}>
                                        <div style={{ fontWeight: 'bold' }}>{group.displayName}</div>
                                        <div style={{ fontSize: '12px', color: '#666' }}>
                                          {group.indicatorCount} indicators
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <Box padding="8px">
                                <p>No indicator groups available</p>
                              </Box>
                            )}
                          </div>
                          
                          {selectedIndicatorGroup && (
                            <Box background="#f0f8ff" padding="8px" margin="8px 0 0 0" borderRadius="4px">
                              <strong>Selected:</strong> <span style={{ color: '#4caf50', marginRight: '4px' }}>✓</span>{selectedIndicatorGroup.displayName}
                            </Box>
                          )}
                        </div>
                      )}
                      
                      {/* Show programs with program indicators for program indicator selection */}
                      {dataType === 'programIndicator' && (
                        <div>
                          <p style={{ fontSize: '14px', marginBottom: '8px' }}>Select a program</p>
                          
                          <div style={{ 
                            maxHeight: '200px', 
                            overflow: 'auto', 
                            border: '1px solid #e0e0e0',
                            borderRadius: '4px',
                            backgroundColor: '#f9f9f9'
                          }}>
                            {availableProgramsForIndicators.length > 0 ? (
                              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <tbody>
                                  {availableProgramsForIndicators.map(program => (
                                    <tr 
                                      key={program.id}
                                      onClick={() => handleProgramForIndicatorsSelect(program.id)}
                                      style={{ 
                                        cursor: 'pointer',
                                        backgroundColor: selectedProgramForIndicators && selectedProgramForIndicators.id === program.id ? '#e3f2fd' : 'transparent',
                                        borderBottom: '1px solid #e0e0e0'
                                      }}
                                    >
                                      <td style={{ padding: '8px' }}>
                                        <div style={{ fontWeight: 'bold' }}>{program.displayName}</div>
                                        <div style={{ fontSize: '12px', color: '#666' }}>
                                          {program.indicatorCount} program indicators
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <Box padding="8px">
                                <p>No programs with indicators available</p>
                              </Box>
                            )}
                          </div>
                          
                          {selectedProgramForIndicators && (
                            <Box background="#f0f8ff" padding="8px" margin="8px 0 0 0" borderRadius="4px">
                              <strong>Selected:</strong> <span style={{ color: '#4caf50', marginRight: '4px' }}>✓</span>{selectedProgramForIndicators.displayName}
                            </Box>
                          )}
                        </div>
                      )}
                      
                      {(dataType === 'event' || dataType === 'tracker') && (
                        <div>
                          <p style={{ fontSize: '14px', marginBottom: '8px' }}>
                            Select a {dataType === 'event' ? 'event' : 'tracker'} program
                          </p>
                          
                          <div style={{ 
                            maxHeight: '200px', 
                            overflow: 'auto', 
                            border: '1px solid #e0e0e0',
                            borderRadius: '4px',
                            backgroundColor: '#f9f9f9'
                          }}>
                            {availablePrograms.length > 0 ? (
                              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <tbody>
                                  {availablePrograms.map(program => (
                                    <tr 
                                      key={program.id}
                                      onClick={() => handleProgramSelect(program.id)}
                                      style={{ 
                                        cursor: 'pointer',
                                        backgroundColor: selectedProgram && selectedProgram.id === program.id ? '#e3f2fd' : 'transparent',
                                        borderBottom: '1px solid #e0e0e0'
                                      }}
                                    >
                                      <td style={{ padding: '8px' }}>
                                        <div style={{ fontWeight: 'bold' }}>{program.displayName}</div>
                                        {program.description && (
                                          <div style={{ fontSize: '12px', color: '#666' }}>
                                            {program.description.length > 60 ? program.description.substring(0, 60) + '...' : program.description}
                                          </div>
                                        )}
                                        {program.type === 'tracker' && program.trackedEntityType && (
                                          <div style={{ fontSize: '12px', color: '#666' }}>
                                            Tracked entity: {program.trackedEntityType}
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <Box padding="8px">
                                <p>No programs available</p>
                              </Box>
                            )}
                          </div>
                          
                          {selectedProgram && (
                            <Box background="#f0f8ff" padding="8px" margin="8px 0 0 0" borderRadius="4px">
                              <strong>Selected:</strong> <span style={{ color: '#4caf50', marginRight: '4px' }}>✓</span>{selectedProgram.displayName}
                            </Box>
                          )}
                        </div>
                      )}
                    </details>
                  </Box>
                  
                  {/* Period Selection - Always visible */}
                  <Box 
                    margin="0 0 24px 0" 
                    padding="16px"
                    borderRadius="4px"
                    background="#f9f9f9"
                  >
                    <SingleSelectField
                      label="Analysis Period"
                      selected={selectedPeriod}
                      onChange={handlePeriodChange}
                      className="selector-field"
                      dense
                    >
                      {periods.map(period => (
                        <SingleSelectOption 
                          key={period.id} 
                          value={period.id} 
                          label={period.name} 
                        />
                      ))}
                    </SingleSelectField>
                  </Box>
                </div>
                
                {/* Right side: Step 4 - Data Elements Selection */}
                <div style={{ 
                  flex: 1, 
                  opacity: selectionStep < 4 ? 0.6 : 1,
                  minHeight: selectionStep < 4 ? '200px' : '450px'
                }}>
                  <Box 
                    padding="20px"
                    borderColor={selectionStep === 4 ? '#2196F3' : '#e0e0e0'} 
                    borderWidth="2px"
                    borderStyle="solid"
                    borderRadius="4px"
                    marginBottom="24px"
                  >
                    <h3 style={{ marginTop: 0, marginBottom: '8px' }}>
                      Step 4: Select {
                        dataType === 'indicator' ? 'Indicators' :
                        dataType === 'programIndicator' ? 'Program Indicators' :
                        'Data Elements'
                      }
                      {selectedDataElements && selectedDataElements.length > 0 && <span style={{ color: '#4caf50' }}> ✓</span>}
                    </h3>
                    <p style={{ fontSize: '14px', marginBottom: '12px' }}>
                      {selectionStep < 4 
                        ? 'First complete steps 1-3 to see available options' 
                        : (dataType === 'indicator'
                            ? 'Select indicators to analyze'
                            : (dataType === 'programIndicator'
                              ? 'Select program indicators to analyze'
                              : (selectedProgram 
                                  ? `Select data elements from the ${selectedProgram.displayName} program` 
                                  : (selectedDataSet 
                                      ? `Select data elements from the ${selectedDataSet.displayName} dataset`
                                      : 'Select data elements to analyze')
                                )
                            )
                          )
                      }
                    </p>
                    
                    <Transfer
                      onChange={handleTransferChange}
                      options={transferData.options}
                      selected={selectedDataElements}
                      leftHeader={transferData.leftHeader}
                      rightHeader={transferData.rightHeader}
                      height="300px"
                      filterable
                      disabled={selectionStep < 4}
                    />
                    
                    {selectedDataElements && selectedDataElements.length > 0 && (
                      <Box background="#f0f8ff" padding="8px" margin="12px 0 0 0" borderRadius="4px">
                        <strong>Selected <span style={{ color: '#4caf50', marginRight: '4px' }}>✓</span>{selectedDataElements.length} data element(s):</strong>
                        <div style={{ maxHeight: '80px', overflow: 'auto', marginTop: '4px', fontSize: '14px' }}>
                          {selectedElementsWithMetadata.map(element => (
                            <div key={element.id} style={{ marginBottom: '4px' }}>
                              • <strong>{element.displayName}</strong>
                              {element.parentName && <span style={{ color: '#666' }}> [{element.parentName}]</span>}
                            </div>
                          ))}
                        </div>
                      </Box>
                    )}
                  </Box>
                </div>
              </div>
            )}
          </>
        )}
      </Box>
    </Card>
  )
}